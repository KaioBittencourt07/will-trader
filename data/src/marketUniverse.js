export const MARKET_UNIVERSES = Object.freeze({
  FOREX: Object.freeze([
    'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD', 'NZD/USD', 'USD/CAD',
    'EUR/GBP', 'EUR/JPY', 'GBP/JPY', 'AUD/JPY', 'CAD/JPY'
  ]),
  CRYPTO: Object.freeze([
    'BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'ADA/USD', 'DOGE/USD',
    'AVAX/USD', 'LINK/USD', 'LTC/USD', 'BCH/USD', 'DOT/USD', 'MATIC/USD'
  ]),
  STOCKS: Object.freeze([
    'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AMD',
    'NFLX', 'AVGO', 'JPM', 'V', 'WMT', 'XOM', 'KO', 'DIS'
  ])
});

function className(value = 'ALL') {
  const normalized = String(value).trim().toUpperCase();
  if (normalized !== 'ALL' && !MARKET_UNIVERSES[normalized]) {
    throw new Error('Classe de ativo inválida. Use ALL, FOREX, CRYPTO ou STOCKS.');
  }
  return normalized;
}

/** Rotates a bounded watchlist instead of claiming a whole provider universe was read at once. */
export function createMarketUniverseScheduler({ universes = MARKET_UNIVERSES, now = () => Date.now() } = {}) {
  const cursors = new Map();
  const deferred = new Map();
  function isDeferred(asset) {
    const until = deferred.get(asset);
    if (!until) return false;
    if (until <= now()) {
      deferred.delete(asset);
      return false;
    }
    return true;
  }
  function take({ assetClass = 'ALL', limit = 4 } = {}) {
    const selectedClass = className(assetClass);
    const universe = selectedClass === 'ALL' ? Object.values(universes).flat() : universes[selectedClass];
    const requested = Math.max(1, Math.min(Number(limit) || 1, universe.length));
    const start = cursors.get(selectedClass) ?? 0;
    const assets = [];
    let cursor = start;
    for (let inspected = 0; inspected < universe.length && assets.length < requested; inspected += 1) {
      const asset = universe[cursor];
      cursor = (cursor + 1) % universe.length;
      if (!isDeferred(asset)) assets.push(asset);
    }
    const next = cursor;
    cursors.set(selectedClass, next);
    return {
      assetClass: selectedClass,
      assets,
      totalAssets: universe.length,
      nextAsset: universe[next],
      completesCycle: next === 0,
      deferredAssets: [...deferred.keys()].filter((asset) => universe.includes(asset)).length
    };
  }
  function defer(asset, cooldownMs = 15 * 60_000) {
    const normalized = String(asset).trim().toUpperCase();
    if (!normalized) return;
    deferred.set(normalized, now() + Math.max(0, Number(cooldownMs) || 0));
  }
  return { take, defer };
}
