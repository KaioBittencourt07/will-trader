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

import { readFileSync } from 'node:fs';

const CLASSES = Object.freeze(['FOREX', 'CRYPTO', 'STOCKS']);
export const AVALON_ALLOWLIST_VERSION = 'avalon-allowlist-v1';
export const AVALON_CATALOG_UNVERIFIED = 'AVALON_CATALOG_UNVERIFIED';
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

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

function iso(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function catalogFailure(reason) {
  return { confirmed: false, reason, source: 'unverified', verifiedAt: null, entries: [] };
}

// This intentionally only reads a local export. It neither logs into Avalon
// nor infers tradability from a price provider or an example symbol.
function readVerifiedAllowlist({ filePath, readFile, now, maxAgeMs }) {
  if (!filePath) return catalogFailure('ALLOWLIST_NOT_CONFIGURED');
  let document;
  try { document = JSON.parse(readFile(filePath, 'utf8')); } catch { return catalogFailure('ALLOWLIST_UNREADABLE_OR_INVALID'); }
  if (document?.version !== AVALON_ALLOWLIST_VERSION || !Array.isArray(document.assets) || !document.assets.length) {
    return catalogFailure('ALLOWLIST_SCHEMA_INVALID');
  }
  const entries = [];
  const seen = new Set();
  for (const candidate of document.assets) {
    const asset = normalize(candidate?.asset);
    const brokerSymbol = String(candidate?.brokerSymbol ?? '').trim();
    const source = String(candidate?.source ?? '').trim();
    const verifiedAt = iso(candidate?.verifiedAt);
    const status = String(candidate?.status ?? '').trim().toUpperCase();
    const expiresAt = candidate?.expiresAt === undefined ? null : iso(candidate.expiresAt);
    if (!asset || !brokerSymbol || !source || /unverified|unknown/i.test(source) || !verifiedAt || !status || seen.has(asset)) {
      return catalogFailure('ALLOWLIST_ENTRY_INVALID');
    }
    const expiresMs = expiresAt ? Date.parse(expiresAt) : Date.parse(verifiedAt) + maxAgeMs;
    if (Date.parse(verifiedAt) > now || expiresMs <= now) return catalogFailure('ALLOWLIST_EXPIRED');
    seen.add(asset);
    entries.push(Object.freeze({ asset, brokerSymbol, source, verifiedAt, expiresAt, status }));
  }
  const source = String(document.source ?? entries[0].source).trim();
  const verifiedAt = iso(document.verifiedAt) ?? entries.reduce((latest, entry) => latest > entry.verifiedAt ? latest : entry.verifiedAt, entries[0].verifiedAt);
  return Object.freeze({ confirmed: true, reason: 'VERIFIED_ALLOWLIST', source, verifiedAt, entries: Object.freeze(entries) });
}

export function createAvalonCatalog({ environment = process.env, readFile = readFileSync, now = Date.now } = {}) {
  if (environment.AVALON_ALLOWLIST_FILE) {
    const maxAge = Number(environment.AVALON_CATALOG_MAX_AGE_MS ?? DEFAULT_MAX_AGE_MS);
    return createFileCatalog(readVerifiedAllowlist({
      filePath: environment.AVALON_ALLOWLIST_FILE,
      readFile,
      now: typeof now === 'function' ? now() : now,
      maxAgeMs: Number.isFinite(maxAge) && maxAge >= 0 ? maxAge : DEFAULT_MAX_AGE_MS
    }));
  }
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
      status: !listed ? 'NOT_TRADABLE_ON_AVALON' : !confirmed ? AVALON_CATALOG_UNVERIFIED : 'TRADABLE_ON_AVALON'
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

function createFileCatalog(allowlist) {
  const byAsset = new Map(allowlist.entries.map((entry) => [entry.asset, entry]));
  const confirmed = allowlist.confirmed;
  const listed = allowlist.entries.map((entry) => entry.asset);
  const operational = Object.freeze(listed.filter((asset) => {
    const entry = byAsset.get(asset);
    return confirmed && entry.status === 'TRADABLE';
  }));
  const universes = Object.freeze(Object.fromEntries(CLASSES.map((assetClass) => [assetClass, Object.freeze([...listed])])));

  function resolve(asset) {
    const normalized = normalize(asset);
    const entry = byAsset.get(normalized);
    const tradable = Boolean(confirmed && entry?.status === 'TRADABLE');
    return {
      asset: normalized,
      broker: 'Avalon',
      brokerSymbol: tradable ? entry.brokerSymbol : null,
      brokerTradable: tradable,
      catalogSource: entry?.source ?? allowlist.source,
      catalogVerifiedAt: entry?.verifiedAt ?? allowlist.verifiedAt,
      status: !confirmed ? AVALON_CATALOG_UNVERIFIED : !entry || entry.status !== 'TRADABLE' ? 'NOT_TRADABLE_ON_AVALON' : 'TRADABLE_ON_AVALON'
    };
  }

  return Object.freeze({
    broker: 'Avalon',
    source: allowlist.source,
    verifiedAt: allowlist.verifiedAt,
    catalogStatus: confirmed ? 'VERIFIED' : AVALON_CATALOG_UNVERIFIED,
    catalogReason: allowlist.reason,
    universes,
    operationalUniverses: Object.freeze(Object.fromEntries(CLASSES.map((assetClass) => [assetClass, operational]))),
    isConfirmed: () => confirmed,
    isAllowed: (asset) => byAsset.has(normalize(asset)),
    resolve,
    assertAllowed(assets = []) {
      const normalized = [...new Set(assets.map(normalize).filter(Boolean))];
      const unsupported = normalized.filter((asset) => !byAsset.has(asset));
      if (unsupported.length) throw new Error(`Ativo fora do catálogo operacional Avalon: ${unsupported.join(', ')}.`);
      return normalized;
    }
  });
}

