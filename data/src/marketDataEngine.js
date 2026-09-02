function keyFor(asset, timeframe, outputsize) {
  return `${String(asset).toUpperCase()}|${timeframe}|${outputsize}`;
}

export function createMarketDataEngine({ provider, cacheTtlMs = Number(process.env.MARKET_CACHE_TTL_MS || 10_000), minRequestIntervalMs = Number(process.env.MARKET_MIN_REQUEST_INTERVAL_MS || 60_000), maxRetries = Number(process.env.MARKET_MAX_RETRIES || 2), retryBaseMs = Number(process.env.MARKET_RETRY_BASE_MS || 500), retryMaxMs = Number(process.env.MARKET_RETRY_MAX_MS || 10_000), retryWindowMs = Number(process.env.MARKET_RETRY_WINDOW_MS || 60_000), retryWindowLimit = Number(process.env.MARKET_RETRY_WINDOW_LIMIT || 4), now = () => Date.now(), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), random = Math.random } = {}) {
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
    upstreamLatencyMsTotal: 0,
    upstreamLatencySamples: 0,
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

  function recordProviderError(error) {
    metrics.providerErrors += 1;
    if (/\b429\b|too many requests|rate limit/i.test(String(error?.message ?? error))) metrics.provider429 += 1;
    metrics.lastProviderError = String(error?.message ?? error).slice(0, 500);
    metrics.lastErrorAt = new Date(now()).toISOString();
    const state = /\b429\b|too many requests|rate limit/i.test(metrics.lastProviderError)
      ? 'RATE_LIMITED'
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

  async function timedProviderRequest(work) {
    const startedAt = now();
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const result = await work();
          recordProviderSuccess();
          return result;
        } catch (error) {
          recordProviderError(error);
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

  async function fetchWithRateLimit(asset, timeframe, outputsize) {
    const delay = Math.max(0, nextRequestAt - now());
    if (delay) await wait(delay);
    nextRequestAt = now() + Math.max(0, minRequestIntervalMs);
    metrics.upstreamRequests += 1;
    return timedProviderRequest(() => provider.getSnapshot(asset, timeframe, outputsize));
  }

  async function getSnapshot(asset, timeframe = '1min', outputsize = 50) {
    const key = keyFor(asset, timeframe, outputsize);
    const cached = cache.get(key);
    if (cached && now() - cached.storedAt < cacheTtlMs) {
      metrics.cacheHits += 1;
      return cached.snapshot;
    }
    if (inFlight.has(key)) {
      metrics.deduplicated += 1;
      return inFlight.get(key);
    }
    metrics.cacheMisses += 1;
    const request = fetchWithRateLimit(asset, timeframe, outputsize)
      .then((snapshot) => {
        cache.set(key, { snapshot, storedAt: now() });
        return snapshot;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, request);
    return request;
  }

  async function getSnapshots(assets = [], timeframe = '1min', outputsize = 50) {
    const uniqueAssets = [...new Set(assets.map((asset) => String(asset).trim().toUpperCase()).filter(Boolean))];
    if (!uniqueAssets.length) return [];
    if (typeof provider.getSnapshots !== 'function') {
      return Promise.all(uniqueAssets.map(async (asset) => {
        try { return { asset, snapshot: await getSnapshot(asset, timeframe, outputsize), error: null }; }
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
        fresh.push({ asset, snapshot: cached.snapshot, error: null });
      } else missing.push(asset);
    }
    if (!missing.length) return uniqueAssets.map((asset) => fresh.find((entry) => entry.asset === asset));
    metrics.cacheMisses += missing.length;
    const delay = Math.max(0, nextRequestAt - now());
    if (delay) await wait(delay);
    nextRequestAt = now() + Math.max(0, minRequestIntervalMs);
    metrics.upstreamRequests += 1;
    let fetched;
    try {
      fetched = await timedProviderRequest(() => provider.getSnapshots(missing, timeframe, outputsize));
    } catch (error) {
      throw error;
    }
    for (const entry of fetched) {
      if (entry?.error) recordProviderError(entry.error);
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
      cacheEntries: cache.size,
      degradedDurationMs: metrics.degradedSince === null ? 0 : Math.max(0, now() - metrics.degradedSince),
      upstreamLatencyMsAverage: metrics.upstreamLatencySamples
        ? metrics.upstreamLatencyMsTotal / metrics.upstreamLatencySamples
        : null
    }),
    clearCache: () => cache.clear()
  };
}
