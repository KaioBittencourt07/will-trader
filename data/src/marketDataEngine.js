function keyFor(asset, timeframe, outputsize) {
  return `${String(asset).toUpperCase()}|${timeframe}|${outputsize}`;
}

import { addProviderEfficiency } from './providerEfficiency.js';
import { refreshMarketSnapshotFreshness } from './marketAdapter.js';

export function createMarketDataEngine({ provider, cacheTtlMs = Number(process.env.MARKET_CACHE_TTL_MS || 10_000), minRequestIntervalMs = Number(process.env.MARKET_MIN_REQUEST_INTERVAL_MS || 60_000), maxRetries = Number(process.env.MARKET_MAX_RETRIES || 2), retryBaseMs = Number(process.env.MARKET_RETRY_BASE_MS || 500), retryMaxMs = Number(process.env.MARKET_RETRY_MAX_MS || 10_000), retryWindowMs = Number(process.env.MARKET_RETRY_WINDOW_MS || 60_000), retryWindowLimit = Number(process.env.MARKET_RETRY_WINDOW_LIMIT || 4), rateLimitCooldownMs = Number(process.env.MARKET_RATE_LIMIT_COOLDOWN_MS || 60_000), maxRateLimitCooldownMs = Number(process.env.MARKET_MAX_RATE_LIMIT_COOLDOWN_MS || 900_000), now = () => Date.now(), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), random = Math.random } = {}) {
  if (!provider || typeof provider.getSnapshot !== 'function') throw new Error('provider.getSnapshot é obrigatório.');
  const cache = new Map();
  const inFlight = new Map();
  let nextRequestAt = 0;
  const metrics = {
    cacheHits: 0,
    cacheMisses: 0,
    deduplicated: 0,
    upstreamRequests: 0,
    providerErrors: 0,
    provider429: 0,
    blockedByCooldown: 0,
    rateLimitEvents: 0,
    upstreamLatencyMsTotal: 0,
    upstreamLatencySamples: 0,
    rateLimitWaitMsTotal: 0,
    rateLimitWaitCount: 0,
    lastProviderError: null,
    retries: 0,
    retryExhausted: 0,
    backoffMsTotal: 0,
    lastSuccessAt: null,
    lastErrorAt: null,
    providerState: 'HEALTHY',
    degradedSince: null
  };
  const retryAttempts = [];
  let cooldownUntil = 0;
  let lastRateLimitEvidence = null;

  function rateLimited(error) {
    return Number(error?.status) === 429 || /\b429\b|too many requests|rate limit/i.test(String(error?.message ?? error));
  }

  function cooldownFrom(error) {
    const current = now();
    const explicitMs = Number(error?.retryAfterMs);
    const retryAt = Date.parse(error?.retryAfterAt ?? '');
    const resetAt = Date.parse(error?.rateLimitResetAt ?? '');
    const requested = Number.isFinite(explicitMs) && explicitMs >= 0 ? explicitMs
      : Number.isFinite(retryAt) ? Math.max(0, retryAt - current)
        : Number.isFinite(resetAt) ? Math.max(0, resetAt - current)
          : Math.max(0, rateLimitCooldownMs);
    return current + Math.min(Math.max(0, maxRateLimitCooldownMs), requested);
  }

  function readiness() {
    const checkedAt = now();
    const remainingMs = Math.max(0, cooldownUntil - checkedAt);
    let state = 'READY';
    if (remainingMs > 0) state = 'COOLDOWN';
    else if (metrics.providerState === 'OFFLINE' || metrics.providerState === 'DEGRADED') state = 'UNAVAILABLE';
    else if (metrics.providerState === 'MISCONFIGURED') state = 'MISCONFIGURED';
    return {
      version: 'provider-readiness-v1', state, cause: remainingMs > 0 ? 'RATE_LIMITED' : null,
      checkedAt: new Date(checkedAt).toISOString(), cooldownUntil: cooldownUntil ? new Date(cooldownUntil).toISOString() : null,
      cooldownRemainingMs: remainingMs, lastEventState: lastRateLimitEvidence ? 'RATE_LIMITED' : null,
      lastRateLimitEvidence, inspectConsumesProvider: false
    };
  }

  function assertReady(telemetry) {
    const current = readiness();
    if (current.state !== 'COOLDOWN') return;
    metrics.blockedByCooldown += 1;
    metrics.providerState = 'COOLDOWN';
    addProviderEfficiency(telemetry, { blockedByCooldown: 1 });
    const error = new Error('Provider cooldown active');
    error.status = 429;
    error.code = 'PROVIDER_COOLDOWN';
    error.cooldownUntil = current.cooldownUntil;
    error.cooldownRemainingMs = current.cooldownRemainingMs;
    throw error;
  }

  function recordProviderError(error, telemetry) {
    metrics.providerErrors += 1;
    if (rateLimited(error)) {
      metrics.provider429 += 1;
      metrics.rateLimitEvents += 1;
      addProviderEfficiency(telemetry, { rateLimitEvents: 1 });
      cooldownUntil = Math.max(cooldownUntil, cooldownFrom(error));
      lastRateLimitEvidence = {
        httpStatus: Number(error?.status) || 429,
        retryAfterProvided: error?.rateLimitEvidence?.retryAfterProvided === true || Number.isFinite(Number(error?.retryAfterMs)) || Boolean(error?.retryAfterAt),
        resetProvided: error?.rateLimitEvidence?.resetProvided === true || Boolean(error?.rateLimitResetAt),
        cooldownSource: Number.isFinite(Number(error?.retryAfterMs)) || error?.retryAfterAt ? 'RETRY_AFTER' : error?.rateLimitResetAt ? 'RESET_HEADER' : 'LOCAL_DEFAULT'
      };
    }
    metrics.lastProviderError = String(error?.message ?? error).slice(0, 500);
    metrics.lastErrorAt = new Date(now()).toISOString();
    const state = rateLimited(error)
      ? 'RATE_LIMITED'
      : [401, 403].includes(Number(error?.status)) || /API_KEY|credential|unauthori[sz]ed|forbidden/i.test(metrics.lastProviderError) ? 'MISCONFIGURED'
        : /ECONNREFUSED|ENOTFOUND|network unreachable/i.test(metrics.lastProviderError) ? 'OFFLINE' : 'DEGRADED';
    metrics.providerState = state;
    metrics.degradedSince ??= now();
  }

  function recordProviderSuccess() {
    metrics.lastSuccessAt = new Date(now()).toISOString();
    metrics.providerState = 'HEALTHY';
    metrics.degradedSince = null;
  }

  function canRetry() {
    const cutoff = now() - Math.max(0, retryWindowMs);
    while (retryAttempts.length && retryAttempts[0] < cutoff) retryAttempts.shift();
    return retryAttempts.length < Math.max(0, retryWindowLimit);
  }

  function transient(error) {
    const status = Number(error?.status);
    return status === 429 || status >= 500 || /\b429\b|timeout|network|temporar|rate limit/i.test(String(error?.message ?? error));
  }

  function retryDelay(error, attempt) {
    const retryAfterMs = Number(error?.retryAfterMs);
    if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) return Math.min(retryMaxMs, retryAfterMs);
    const exponential = Math.min(retryMaxMs, retryBaseMs * (2 ** attempt));
    return Math.max(0, Math.min(retryMaxMs, Math.round(exponential * (0.5 + Math.max(0, Math.min(1, random()))))));
  }

  async function timedProviderRequest(work, telemetry) {
    const startedAt = now();
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const result = await work();
          recordProviderSuccess();
          return result;
        } catch (error) {
          recordProviderError(error, telemetry);
          if (rateLimited(error)) throw error;
          if (!transient(error) || attempt >= maxRetries || !canRetry()) {
            if (transient(error)) metrics.retryExhausted += 1;
            throw error;
          }
          const delay = retryDelay(error, attempt);
          retryAttempts.push(now());
          metrics.retries += 1;
          metrics.backoffMsTotal += delay;
          await wait(delay);
        }
      }
    } finally {
      metrics.upstreamLatencyMsTotal += Math.max(0, now() - startedAt);
      metrics.upstreamLatencySamples += 1;
    }
  }

  async function fetchWithRateLimit(asset, timeframe, outputsize, telemetry) {
    assertReady(telemetry);
    const delay = Math.max(0, nextRequestAt - now());
    if (delay) {
      metrics.rateLimitWaitMsTotal += delay;
      metrics.rateLimitWaitCount += 1;
      addProviderEfficiency(telemetry, { limiterWaitMs: delay });
      await wait(delay);
      assertReady(telemetry);
    }
    nextRequestAt = now() + Math.max(0, minRequestIntervalMs);
    metrics.upstreamRequests += 1;
    return timedProviderRequest(() => telemetry
      ? provider.getSnapshot(asset, timeframe, outputsize, { telemetry })
      : provider.getSnapshot(asset, timeframe, outputsize), telemetry);
  }

  async function getSnapshot(asset, timeframe = '1min', outputsize = 50, { telemetry } = {}) {
    const key = keyFor(asset, timeframe, outputsize);
    const cached = cache.get(key);
    if (cached && now() - cached.storedAt < cacheTtlMs) {
      metrics.cacheHits += 1;
      addProviderEfficiency(telemetry, { cacheHits: 1 });
      return refreshMarketSnapshotFreshness(cached.snapshot, { now: now(), cacheStoredAt: cached.storedAt });
    }
    if (inFlight.has(key)) {
      metrics.deduplicated += 1;
      addProviderEfficiency(telemetry, { deduplicated: 1 });
      return inFlight.get(key);
    }
    metrics.cacheMisses += 1;
    addProviderEfficiency(telemetry, { cacheMisses: 1 });
    const request = fetchWithRateLimit(asset, timeframe, outputsize, telemetry)
      .then((snapshot) => {
        cache.set(key, { snapshot, storedAt: now() });
        return snapshot;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, request);
    return request;
  }

  async function getSnapshots(assets = [], timeframe = '1min', outputsize = 50, { telemetry } = {}) {
    const uniqueAssets = [...new Set(assets.map((asset) => String(asset).trim().toUpperCase()).filter(Boolean))];
    if (!uniqueAssets.length) return [];
    // The diagnostic and one-symbol scanner use the same canonical request.
    // Route both through getSnapshot so they share cache, in-flight coalescing
    // and the centralized cooldown instead of racing two provider operations.
    if (uniqueAssets.length === 1) {
      const asset = uniqueAssets[0];
      try { return [{ asset, snapshot: await getSnapshot(asset, timeframe, outputsize, { telemetry }), error: null }]; }
      catch (error) { return [{ asset, snapshot: null, error: error.message }]; }
    }
    if (typeof provider.getSnapshots !== 'function') {
      return Promise.all(uniqueAssets.map(async (asset) => {
          try { return { asset, snapshot: await getSnapshot(asset, timeframe, outputsize, { telemetry }), error: null }; }
        catch (error) { return { asset, snapshot: null, error: error.message }; }
      }));
    }
    const fresh = [];
    const missing = [];
    for (const asset of uniqueAssets) {
      const key = keyFor(asset, timeframe, outputsize);
      const cached = cache.get(key);
      if (cached && now() - cached.storedAt < cacheTtlMs) {
        metrics.cacheHits += 1;
        addProviderEfficiency(telemetry, { cacheHits: 1 });
        fresh.push({ asset, snapshot: refreshMarketSnapshotFreshness(cached.snapshot, { now: now(), cacheStoredAt: cached.storedAt }), error: null });
      } else missing.push(asset);
    }
    if (!missing.length) return uniqueAssets.map((asset) => fresh.find((entry) => entry.asset === asset));
    assertReady(telemetry);
    metrics.cacheMisses += missing.length;
    addProviderEfficiency(telemetry, { cacheMisses: missing.length });
    const delay = Math.max(0, nextRequestAt - now());
    if (delay) {
      metrics.rateLimitWaitMsTotal += delay;
      metrics.rateLimitWaitCount += 1;
      addProviderEfficiency(telemetry, { limiterWaitMs: delay });
      await wait(delay);
      assertReady(telemetry);
    }
    nextRequestAt = now() + Math.max(0, minRequestIntervalMs);
    metrics.upstreamRequests += 1;
    let fetched;
    try {
      fetched = await timedProviderRequest(() => telemetry
        ? provider.getSnapshots(missing, timeframe, outputsize, { telemetry })
        : provider.getSnapshots(missing, timeframe, outputsize), telemetry);
    } catch (error) {
      throw error;
    }
    for (const entry of fetched) {
      if (entry?.error) recordProviderError(entry.error, telemetry);
    }
    for (const entry of fetched) {
      if (entry?.snapshot) cache.set(keyFor(entry.asset, timeframe, outputsize), { snapshot: entry.snapshot, storedAt: now() });
    }
    const all = [...fresh, ...fetched];
    return uniqueAssets.map((asset) => all.find((entry) => entry.asset === asset) ?? { asset, snapshot: null, error: 'Ativo não retornado pelo provedor.' });
  }

  return {
    getSnapshot,
    getSnapshots,
    getMetrics: () => ({
      ...metrics,
      providerReadiness: readiness(),
      cacheEntries: cache.size,
      degradedDurationMs: metrics.degradedSince === null ? 0 : Math.max(0, now() - metrics.degradedSince),
      upstreamLatencyMsAverage: metrics.upstreamLatencySamples
        ? metrics.upstreamLatencyMsTotal / metrics.upstreamLatencySamples
        : null
    }),
    getProviderReadiness: readiness,
    clearCache: () => cache.clear()
  };
}
