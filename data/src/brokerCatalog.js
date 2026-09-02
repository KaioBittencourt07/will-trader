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

function configuredAssets(value, fallback, explicit = false) {
  if (!explicit && !value) return [...fallback];
  const parsed = [...new Set(String(value).split(',').map(normalize).filter(Boolean))];
  return explicit ? parsed : (parsed.length ? parsed : [...fallback]);
}

function aliases(value) {
  if (!value) return {};
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([from, to]) => [normalize(from), String(to).trim()]));
  try { return aliases(JSON.parse(value)); } catch { return {}; }
}

export function createAvalonCatalog({ environment = process.env } = {}) {
  const explicitCatalog = ['AVALON_FOREX_ASSETS', 'AVALON_CRYPTO_ASSETS', 'AVALON_STOCK_ASSETS'].some((key) => Object.hasOwn(environment, key));
  const universes = Object.freeze({
    FOREX: Object.freeze(configuredAssets(environment.AVALON_FOREX_ASSETS, AVALON_PUBLIC_CATALOG.FOREX, explicitCatalog)),
    CRYPTO: Object.freeze(configuredAssets(environment.AVALON_CRYPTO_ASSETS, AVALON_PUBLIC_CATALOG.CRYPTO, explicitCatalog)),
    STOCKS: Object.freeze(configuredAssets(environment.AVALON_STOCK_ASSETS, AVALON_PUBLIC_CATALOG.STOCKS, explicitCatalog))
  });
  const allowed = new Set(Object.values(universes).flat());
  const source = String(environment.AVALON_CATALOG_SOURCE ?? 'public-example-unverified').trim() || 'public-example-unverified';
  const verifiedAt = environment.AVALON_CATALOG_VERIFIED_AT && Number.isFinite(Date.parse(environment.AVALON_CATALOG_VERIFIED_AT))
    ? new Date(environment.AVALON_CATALOG_VERIFIED_AT).toISOString() : null;
  const symbolAliases = aliases(environment.AVALON_SYMBOL_ALIASES);
  const confirmed = Boolean(verifiedAt && !/unverified|unknown/i.test(source));

  function assertAllowed(assets = []) {
    const normalized = [...new Set(assets.map(normalize).filter(Boolean))];
    const unsupported = normalized.filter((asset) => !allowed.has(asset));
    if (unsupported.length) {
      throw new Error(`Ativo fora do catálogo operacional Avalon: ${unsupported.join(', ')}.`);
    }
    return normalized;
  }

  function resolve(asset) {
    const normalized = normalize(asset);
    const brokerSymbol = symbolAliases[normalized] ?? normalized;
    const listed = allowed.has(normalized);
    return {
      asset: normalized,
      broker: 'Avalon',
      brokerSymbol: listed ? brokerSymbol : null,
      brokerTradable: listed && confirmed,
      catalogSource: source,
      catalogVerifiedAt: verifiedAt,
      status: !listed ? 'NOT_TRADABLE_ON_AVALON' : !confirmed ? 'AVALON_CATALOG_UNVERIFIED' : 'TRADABLE_ON_AVALON'
    };
  }

  const operationalUniverses = Object.fromEntries(Object.entries(universes).map(([assetClass, assets]) => [assetClass, Object.freeze(assets.filter((asset) => resolve(asset).brokerTradable))]));

  return Object.freeze({
    broker: 'Avalon',
    source,
    verifiedAt,
    universes,
    operationalUniverses: Object.freeze(operationalUniverses),
    isConfirmed: () => confirmed,
    isAllowed: (asset) => allowed.has(normalize(asset)),
    resolve,
    assertAllowed
  });
}
