/**
 * Operational catalog, separate from the market-data provider universe.
 * A price feed knowing a symbol is not proof that it can be traded in Avalon.
 *
 * Defaults contain the symbols published as examples by Avalon.  The account
 * owner can replace each class with the exact symbols shown in their platform
 * through environment variables; no broker login or automated order flow is
 * required for this filter.
 */
export const AVALON_PUBLIC_CATALOG = Object.freeze({
  FOREX: Object.freeze(['EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/BRL', 'EUR/GBP', 'AUD/USD', 'USD/CHF', 'NZD/USD']),
  CRYPTO: Object.freeze(['BTC/USD', 'ETH/USD', 'SOL/USD', 'ADA/USD', 'BNB/USD', 'XRP/USD', 'DOGE/USD', 'MATIC/USD']),
  STOCKS: Object.freeze(['AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN', 'GOOGL', 'META', 'AMD'])
});

const CLASSES = Object.freeze(['FOREX', 'CRYPTO', 'STOCKS']);

function normalize(asset) {
  return String(asset ?? '').trim().toUpperCase();
}

function configuredAssets(value, fallback) {
  if (!value) return [...fallback];
  const parsed = [...new Set(String(value).split(',').map(normalize).filter(Boolean))];
  return parsed.length ? parsed : [...fallback];
}

export function createAvalonCatalog({ environment = process.env } = {}) {
  const universes = Object.freeze({
    FOREX: Object.freeze(configuredAssets(environment.AVALON_FOREX_ASSETS, AVALON_PUBLIC_CATALOG.FOREX)),
    CRYPTO: Object.freeze(configuredAssets(environment.AVALON_CRYPTO_ASSETS, AVALON_PUBLIC_CATALOG.CRYPTO)),
    STOCKS: Object.freeze(configuredAssets(environment.AVALON_STOCK_ASSETS, AVALON_PUBLIC_CATALOG.STOCKS))
  });
  const allowed = new Set(Object.values(universes).flat());

  function assertAllowed(assets = []) {
    const normalized = [...new Set(assets.map(normalize).filter(Boolean))];
    const unsupported = normalized.filter((asset) => !allowed.has(asset));
    if (unsupported.length) {
      throw new Error(`Ativo fora do catálogo operacional Avalon: ${unsupported.join(', ')}.`);
    }
    return normalized;
  }

  return Object.freeze({
    broker: 'Avalon',
    source: 'configured-public-catalog',
    universes,
    isAllowed: (asset) => allowed.has(normalize(asset)),
    assertAllowed
  });
}
