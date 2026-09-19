import { createTemporalAuthorityProvider } from './temporalAuthorityProvider.js';

export const OANDA_TEMPORAL_AUTHORITY_VERSION = 'oanda-pricing-temporal-authority-v1';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

export function observationFromOandaPricing({ pricingResponse, receivedAt, canonicalSymbol = 'EUR/USD', providerSymbol = 'EUR_USD' } = {}) {
  const price = pricingResponse?.prices?.find((entry) => entry?.instrument === providerSymbol);
  if (!price) fail('OANDA_TEMPORAL_PRICE_MISSING');
  const eventMs = Date.parse(price.time ?? '');
  if (!Number.isFinite(eventMs)) fail('OANDA_TEMPORAL_EVENT_TIME_MISSING');
  if (!Number.isFinite(Date.parse(receivedAt ?? ''))) fail('OANDA_TEMPORAL_RECEIVE_TIME_MISSING');
  return Object.freeze({
    version: OANDA_TEMPORAL_AUTHORITY_VERSION,
    provider: 'oanda-pricing-v20',
    symbol: canonicalSymbol,
    eventTimestamp: eventMs,
    receivedAt,
    timestampAuthority: 'OANDA_PRICING_PROVIDER_EVENT_TIME',
    provenanceVerified: true,
    perEventSemanticsVerified: false,
    semanticState: 'FIELD_PROVENANCE_ONLY_EXTERNAL_RUNTIME_UNVERIFIED',
    price: Number(price.closeoutBid ?? NaN) > 0 && Number(price.closeoutAsk ?? NaN) > 0
      ? (Number(price.closeoutBid) + Number(price.closeoutAsk)) / 2
      : null,
    decisionImpact: 'NONE'
  });
}

export function createOandaTemporalAuthorityProvider({ observePricing } = {}) {
  if (typeof observePricing !== 'function') throw new Error('OANDA_TEMPORAL_OBSERVER_REQUIRED');
  return createTemporalAuthorityProvider({
    id: 'oanda-pricing-v20',
    observe: async (symbol, options = {}) => {
      const payload = await observePricing(symbol, options);
      return observationFromOandaPricing(payload);
    }
  });
}
