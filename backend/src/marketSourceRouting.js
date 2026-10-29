import {
  coinbasePublicProductFor
} from '../../data/src/providers/coinbaseExchangePublicProvider.js';
import {
  binancePublicSymbolFor
} from '../../data/src/providers/binanceSpotPublicProvider.js';

const normalizeAssets = (values) => [...new Set((Array.isArray(values) ? values : [])
  .map((asset) => String(asset ?? '').trim().toUpperCase())
  .filter(Boolean))];

/**
 * Pure routing plan used by the live request path and unit tests.
 * Forced Twelve Data assets are used when a cross-provider composition
 * requires Twelve Data's candle source; public-source quotes are not substituted.
 */
export function planMarketSourceRouting(assets = [], { forceTwelveDataAssets = [] } = {}) {
  const normalized = normalizeAssets(assets);
  const forced = new Set(normalizeAssets(forceTwelveDataAssets));
  const publicAssets = normalized.filter((asset) =>
    !forced.has(asset) && (coinbasePublicProductFor(asset) || binancePublicSymbolFor(asset))
  );
  const directTwelveAssets = normalized.filter((asset) =>
    forced.has(asset) || (!coinbasePublicProductFor(asset) && !binancePublicSymbolFor(asset))
  );
  return Object.freeze({
    normalized: Object.freeze(normalized),
    publicAssets: Object.freeze(publicAssets),
    directTwelveAssets: Object.freeze(directTwelveAssets),
    forcedTwelveDataAssets: Object.freeze(normalized.filter((asset) => forced.has(asset)))
  });
}
