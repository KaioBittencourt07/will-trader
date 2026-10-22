export const MARKET_UNIVERSES = Object.freeze({
  FOREX: Object.freeze([
    'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD', 'NZD/USD', 'USD/CAD',
    'EUR/GBP', 'EUR/JPY', 'GBP/JPY', 'AUD/JPY', 'CAD/JPY'
  ]),
  CRYPTO: Object.freeze([
    'BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'ADA/USD', 'DOGE/USD',
    'AVAX/USD', 'LINK/USD', 'LTC/USD', 'BCH/USD', 'DOT/USD', 'MATIC/USD'
  ]),
  // USDT is a distinct quote currency, not silently converted to USD.
  CRYPTO_USDT: Object.freeze([
    'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'ADA/USDT',
    'DOGE/USDT', 'AVAX/USDT', 'LINK/USDT', 'LTC/USDT', 'BCH/USDT', 'DOT/USDT'
  ]),
  STOCKS: Object.freeze([
    'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AMD',
    'NFLX', 'AVGO', 'JPM', 'V', 'WMT', 'XOM', 'KO', 'DIS'
  ]),
  ETFS: Object.freeze([
    'SPY', 'QQQ', 'DIA', 'IWM', 'GLD', 'SLV', 'TLT', 'USO',
    'XLE', 'XLK', 'XLF', 'ARKK'
  ]),
  INDICES: Object.freeze([
    'SPX', 'NDX', 'DJI', 'RUT', 'VIX', 'DAX', 'FTSE', 'N225'
  ]),
  COMMODITIES: Object.freeze([
    'XAU/USD', 'XAG/USD', 'WTI/USD', 'BRENT/USD', 'NATGAS/USD', 'CORN/USD', 'WHEAT/USD'
  ])
});

export const WILL_PHASE1_FX_CRYPTO = Object.freeze([
  'BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD',
  'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD', 'NZD/USD', 'USD/CAD', 'GBP/JPY'
]);

function className(value = 'ALL') {
  const normalized = String(value).trim().toUpperCase();
  if (normalized !== 'ALL' && normalized !== 'FX_CRYPTO' && !MARKET_UNIVERSES[normalized]) {
    throw new Error('Classe de ativo inválida. Use ALL, FX_CRYPTO, FOREX, CRYPTO, CRYPTO_USDT, STOCKS, ETFS, INDICES ou COMMODITIES.');
  }
  return normalized;
}

/** Rotates a bounded watchlist instead of claiming a whole provider universe was read at once. */
export function createMarketUniverseScheduler({ universes = MARKET_UNIVERSES, now = () => Date.now() } = {}) {
  const cursors = new Map();
  const deferred = new Map();
  const priorities = new Map();
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
    const universe = selectedClass === 'ALL'
      ? Object.values(universes).flat()
      : selectedClass === 'FX_CRYPTO'
        ? WILL_PHASE1_FX_CRYPTO
        : universes[selectedClass];
    if (!universe.length) return { assetClass: selectedClass, assets: [], totalAssets: 0, nextAsset: null, completesCycle: true, deferredAssets: 0 };
    const requested = Math.max(1, Math.min(Number(limit) || 1, universe.length));
    const start = cursors.get(selectedClass) ?? 0;
    const assets = [];
    let cursor = start;
    const ordered = [...universe];
    // Preserve deterministic round-robin when no observations exist. Once an
    // asset is observed, only scan ordering changes; eligibility stays fixed.
    if ([...priorities.values()].some((priority) => priority > 0)) ordered.sort((left, right) => (priorities.get(right) ?? 0) - (priorities.get(left) ?? 0) || universe.indexOf(left) - universe.indexOf(right));
    for (let inspected = 0; inspected < ordered.length && assets.length < requested; inspected += 1) {
      const asset = ordered[cursor];
      cursor = (cursor + 1) % universe.length;
      if (!isDeferred(asset)) assets.push(asset);
    }
    const next = cursor;
    cursors.set(selectedClass, next);
    return {
      assetClass: selectedClass,
      assets,
      totalAssets: universe.length,
      nextAsset: ordered[next],
      completesCycle: next === 0,
      deferredAssets: [...deferred.keys()].filter((asset) => universe.includes(asset)).length
    };
  }
  function defer(asset, cooldownMs = 15 * 60_000) {
    const normalized = String(asset).trim().toUpperCase();
    if (!normalized) return;
    deferred.set(normalized, now() + Math.max(0, Number(cooldownMs) || 0));
  }
  function setPriority(asset, priority = 0) {
    const normalized = String(asset).trim().toUpperCase();
    if (!normalized) return;
    priorities.set(normalized, Math.max(0, Number(priority) || 0));
  }
  return { take, defer, setPriority };
}
