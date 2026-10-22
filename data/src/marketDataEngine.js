function keyFor(asset, timeframe, outputsize) {
  return `${String(asset).toUpperCase()}|${timeframe}|${outputsize}`;
}

import { addProviderEfficiency } from './providerEfficiency.js';
import { refreshMarketSnapshotFreshness } from './marketAdapter.js';

export function createMarketDataEngine({ provider, cacheTtlMs = Number(process.env.MARKET_CACHE_TTL_MS || 10_000), minRequestIntervalMs = Number(process.env.MARKET_MIN_REQUEST_INTERVAL_MS || 60_000), creditBudgetPerMinute = undefined, maxRetries = Number(process.env.MARKET_MAX_RETRIES || 2), retryBaseMs = Number(process.env.MARKET_RETRY_BASE_MS || 500), retryMaxMs = Number(process.env.MARKET_RETRY_MAX_MS || 10_000), retryWindowMs = Number(process.env.MARKET_RETRY_WINDOW_MS || 60_000), retryWindowLimit = Number(process.env.MARKET_RETRY_WINDOW_LIMIT || 4), rateLimitCooldownMs = Number(process.env.MARKET_RATE_LIMIT_COOLDOWN_MS || 60_000), maxRateLimitCooldownMs = Number(process.env.MARKET_MAX_RATE_LIMIT_COOLDOWN_MS || 900_000), now = () => Date.now(), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), random = Math.random } = {}) {
  if (!provider || typeof provider.getSnapshot !== 'function') throw new Error('provider.getSnapshot é obrigatório.');
  const configuredCreditBudget = process.env.MARKET_CREDITS_PER_MINUTE;
  const effectiveCreditBudgetPerMinute = creditBudgetPerMinute !== undefined
    ? creditBudgetPerMinute
    : configuredCreditBudget !== undefined
      ? Number(configuredCreditBudget)
      : provider.providerId === 'twelvedata' ? 6 : null;
  if (effectiveCreditBudgetPerMinute !== null &&
      (!Number.isInteger(effectiveCreditBudgetPerMinute) || effectiveCreditBudgetPerMinute < 1)) {
    throw new Error('MARKET_CREDITS_PER_MINUTE must be a positive integer when configured.');
  }
  const creditUsage = [];
  const cache = new Map();
  const inFlight = new Map();
  let nextRequestAt = 0;
  // Serialize all provider slots, including batch calls and transient retries.
  let requestQueue = Promise.resolve();
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
    estimatedCreditsReserved: 0,
    estimatedHttpRequests: 0,
    creditBudgetWaitMsTotal: 0,
    creditBudgetWaitCount: 0,
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

  function estimateCredits(assets) {
    const estimated = typeof provider.estimateCreditsForAssets === 'function'
      ? Number(provider.estimateCreditsForAssets(assets))
      : Math.max(1, new Set(assets).size);
    if (!Number.isFinite(estimated) || estimated < 1) {
      throw new Error('PROVIDER_CREDIT_ESTIMATE_INVALID');
    }
    return Math.ceil(estimated);
  }

  function estimateHttpRequests(assets) {
    const estimated = typeof provider.estimateHttpRequestsForAssets === 'function'
      ? Number(provider.estimateHttpRequestsForAssets(assets))
      : 1;
    if (!Number.isFinite(estimated) || estimated < 1) {
      throw new Error('PROVIDER_HTTP_REQUEST_ESTIMATE_INVALID');
    }
    return Math.ceil(estimated);
  }

  function maxBatchSymbols() {
    if (effectiveCreditBudgetPerMinute === null || typeof provider.maxSymbolsForCredits !== 'function') return Infinity;
    const maximum = Number(provider.maxSymbolsForCredits(effectiveCreditBudgetPerMinute));
    if (!Number.isInteger(maximum) || maximum < 1) {
      throw new Error('MARKET_CREDIT_BUDGET_TOO_LOW_FOR_SINGLE_ASSET');
    }
    return maximum;
  }

  function pruneCreditUsage(current) {
    const cutoff = current - 60_000;
    while (creditUsage.length && creditUsage[0].at <= cutoff) creditUsage.shift();
  }

  async function reserveCreditBudget(credits, telemetry) {
    if (!Number.isInteger(credits) || credits < 1) throw new Error('PROVIDER_CREDIT_ESTIMATE_INVALID');
    if (effectiveCreditBudgetPerMinute === null) {
      metrics.estimatedCreditsReserved += credits;
      return;
    }
    if (credits > effectiveCreditBudgetPerMinute) throw new Error('PROVIDER_BATCH_CREDITS_EXCEED_BUDGET');

    while (true) {
      const current = now();
      pruneCreditUsage(current);
      const used = creditUsage.reduce((sum, item) => sum + item.credits, 0);
      if (used + credits <= effectiveCreditBudgetPerMinute) {
        creditUsage.push({ at: current, credits });
        metrics.estimatedCreditsReserved += credits;
        return;
      }

      const oldest = creditUsage[0];
      const delay = Math.max(1, oldest.at + 60_000 - current);
      metrics.creditBudgetWaitMsTotal += delay;
      metrics.creditBudgetWaitCount += 1;
      addProviderEfficiency(telemetry, { creditBudgetWaitMs: delay });
      await wait(delay);
      assertReady(telemetry);
    }
  }

  async function withRequestSlot(work, telemetry, estimatedCredits, estimatedHttpRequests) {
    const predecessor = requestQueue;
    let unlock;
    requestQueue = new Promise((resolve) => { unlock = resolve; });
    await predecessor;

    try {
      assertReady(telemetry);
      const delay = Math.max(0, nextRequestAt - now());
      if (delay) {
        metrics.rateLimitWaitMsTotal += delay;
        metrics.rateLimitWaitCount += 1;
        addProviderEfficiency(telemetry, { limiterWaitMs: delay });
        await wait(delay);
        assertReady(telemetry);
      }

      // Reserve credits before the call while holding the same serial queue.
      // The estimate counts each billed symbol/endpoint, not only JS calls.
      await reserveCreditBudget(estimatedCredits, telemetry);
      nextRequestAt = now() + Math.max(0, minRequestIntervalMs);
      return await work(estimatedHttpRequests);
    } finally {
      unlock();
    }
  }

  async function timedProviderAttempt(work, telemetry, estimatedCredits, estimatedHttpRequests) {
    return withRequestSlot(async (httpRequests) => {
      const startedAt = now();
      metrics.upstreamRequests += 1;
      metrics.estimatedHttpRequests += httpRequests;
      try {
        const result = await work();
        recordProviderSuccess();
        return result;
      } catch (error) {
        recordProviderError(error, telemetry);
        throw error;
      } finally {
        metrics.upstreamLatencyMsTotal += Math.max(0, now() - startedAt);
        metrics.upstreamLatencySamples += 1;
      }
    }, telemetry, estimatedCredits, estimatedHttpRequests);
  }

  async function timedProviderRequest(work, telemetry, estimatedCredits = 1, estimatedHttpRequests = 1) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await timedProviderAttempt(work, telemetry, estimatedCredits, estimatedHttpRequests);
      } catch (error) {
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
  }

  async function fetchWithRateLimit(asset, timeframe, outputsize, telemetry) {
    const assets = [String(asset).trim().toUpperCase()];
    return timedProviderRequest(() => telemetry
      ? provider.getSnapshot(asset, timeframe, outputsize, { telemetry })
      : provider.getSnapshot(asset, timeframe, outputsize), telemetry,
      estimateCredits(assets), estimateHttpRequests(assets));
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
    // The one-symbol path deliberately shares getSnapshot's canonical cache and
    // in-flight promise. Multi-symbol batching also registers each missing asset
    // in the same map so a simultaneous diagnostic cannot request it twice.
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
    const waiting = [];
    const missing = [];
    for (const asset of uniqueAssets) {
      const key = keyFor(asset, timeframe, outputsize);
      const cached = cache.get(key);
      if (cached && now() - cached.storedAt < cacheTtlMs) {
        metrics.cacheHits += 1;
        addProviderEfficiency(telemetry, { cacheHits: 1 });
        fresh.push({ asset, snapshot: refreshMarketSnapshotFreshness(cached.snapshot, { now: now(), cacheStoredAt: cached.storedAt }), error: null });
      } else if (inFlight.has(key)) {
        metrics.deduplicated += 1;
        addProviderEfficiency(telemetry, { deduplicated: 1 });
        waiting.push({ asset, promise: inFlight.get(key) });
      } else {
        missing.push(asset);
      }
    }

    const batchPromises = [];
    const batchRequests = [];
    if (missing.length) {
      assertReady(telemetry);
      metrics.cacheMisses += missing.length;
      addProviderEfficiency(telemetry, { cacheMisses: missing.length });

      const chunkSize = Math.min(missing.length, maxBatchSymbols());
      for (let offset = 0; offset < missing.length; offset += chunkSize) {
        const chunk = missing.slice(offset, offset + chunkSize);
        const estimatedCredits = estimateCredits(chunk);
        const estimatedHttpRequests = estimateHttpRequests(chunk);
        const batchRequest = timedProviderRequest(() => telemetry
          ? provider.getSnapshots(chunk, timeframe, outputsize, { telemetry })
          : provider.getSnapshots(chunk, timeframe, outputsize),
        telemetry, estimatedCredits, estimatedHttpRequests).then((entries) => {
          for (const entry of entries) {
            if (entry?.error) recordProviderError(entry.error, telemetry);
            if (entry?.snapshot) {
              cache.set(keyFor(entry.asset, timeframe, outputsize), { snapshot: entry.snapshot, storedAt: now() });
            }
          }
          return entries;
        });
        batchRequests.push(batchRequest);

        for (const asset of chunk) {
          const key = keyFor(asset, timeframe, outputsize);
          let sharedPromise;
          sharedPromise = batchRequest.then((entries) => {
            const entry = entries.find((candidate) => candidate?.asset === asset);
            if (entry?.snapshot) return entry.snapshot;
            const message = entry?.error?.message ?? entry?.error ?? 'Ativo não retornado pelo provedor.';
            throw new Error(String(message));
          }).finally(() => {
            if (inFlight.get(key) === sharedPromise) inFlight.delete(key);
          });
          inFlight.set(key, sharedPromise);
          // Keep failures observed even if no single-symbol caller joined this promise.
          void sharedPromise.catch(() => {});
          batchPromises.push({ asset, promise: sharedPromise });
        }
      }

      await Promise.all(batchRequests);
    }

    const resolvedPending = await Promise.all([...waiting, ...batchPromises].map(async ({ asset, promise }) => {
      try {
        return { asset, snapshot: await promise, error: null };
      } catch (error) {
        return { asset, snapshot: null, error: String(error?.message || 'Market request failed') };
      }
    }));
    const all = [...fresh, ...resolvedPending];
    return uniqueAssets.map((asset) => all.find((entry) => entry.asset === asset)
      ?? { asset, snapshot: null, error: 'Ativo não retornado pelo provedor.' });
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
        : null,
      creditBudgetPerMinute: effectiveCreditBudgetPerMinute,
      estimatedCreditsInCurrentWindow: (() => {
        if (effectiveCreditBudgetPerMinute === null) return null;
        pruneCreditUsage(now());
        return creditUsage.reduce((sum, item) => sum + item.credits, 0);
      })()
    }),
    getProviderReadiness: readiness,
    clearCache: () => cache.clear()
  };
}
