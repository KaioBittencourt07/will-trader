function keyFor(asset, timeframe, outputsize) {
  return `${String(asset).toUpperCase()}|${timeframe}|${outputsize}`;
}

export function createMarketDataEngine({ provider, cacheTtlMs = Number(process.env.MARKET_CACHE_TTL_MS || 10_000), minRequestIntervalMs = Number(process.env.MARKET_MIN_REQUEST_INTERVAL_MS || 60_000), now = () => Date.now(), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  if (!provider || typeof provider.getSnapshot !== 'function') throw new Error('provider.getSnapshot é obrigatório.');
  const cache = new Map();
  const inFlight = new Map();
  let nextRequestAt = 0;
  const metrics = { cacheHits: 0, cacheMisses: 0, deduplicated: 0, upstreamRequests: 0 };

  async function fetchWithRateLimit(asset, timeframe, outputsize) {
    const delay = Math.max(0, nextRequestAt - now());
    if (delay) await wait(delay);
    nextRequestAt = now() + Math.max(0, minRequestIntervalMs);
    metrics.upstreamRequests += 1;
    return provider.getSnapshot(asset, timeframe, outputsize);
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
    const fetched = await provider.getSnapshots(missing, timeframe, outputsize);
    for (const entry of fetched) {
      if (entry?.snapshot) cache.set(keyFor(entry.asset, timeframe, outputsize), { snapshot: entry.snapshot, storedAt: now() });
    }
    const all = [...fresh, ...fetched];
    return uniqueAssets.map((asset) => all.find((entry) => entry.asset === asset) ?? { asset, snapshot: null, error: 'Ativo não retornado pelo provedor.' });
  }

  return { getSnapshot, getSnapshots, getMetrics: () => ({ ...metrics, cacheEntries: cache.size }), clearCache: () => cache.clear() };
}
