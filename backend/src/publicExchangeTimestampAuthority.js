export const PUBLIC_EXCHANGE_TIMESTAMP_QUALIFICATION_VERSION = 'public-exchange-event-time-qualification-v1';

const PROVIDER_CONTRACTS = Object.freeze({
  'coinbase-exchange-rest': Object.freeze({
    fieldName: 'ticker.time',
    semantic: 'LAST_TRADE_EVENT_TIMESTAMP',
    docsUrl: 'https://docs.cdp.coinbase.com/exchange/reference/exchangerestapi_getproductticker'
  }),
  'binance-spot-rest': Object.freeze({
    fieldName: 'trades[0].time',
    semantic: 'LAST_TRADE_EXECUTION_TIMESTAMP',
    docsUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints'
  })
});

export function qualifyPublicExchangeTimestampAuthority({
  source, fieldName, eventTimestamp, receivedAt, quoteAgeMs, maxClockLeadMs = 2_000
} = {}) {
  const contract = PROVIDER_CONTRACTS[String(source ?? '')];
  const field = String(fieldName ?? '');
  const eventMs = Date.parse(eventTimestamp ?? '');
  const receiveMs = Date.parse(receivedAt ?? '');
  const ageMs = Number(quoteAgeMs);
  const reasons = [];

  if (!contract) reasons.push('PUBLIC_EXCHANGE_SOURCE_NOT_QUALIFIED');
  if (contract && field !== contract.fieldName) reasons.push('PUBLIC_EXCHANGE_TIMESTAMP_FIELD_MISMATCH');
  if (!Number.isFinite(eventMs) || !Number.isFinite(receiveMs)) reasons.push('PUBLIC_EXCHANGE_EVENT_OR_RECEIVE_TIME_INVALID');
  if (!Number.isFinite(ageMs)) reasons.push('PUBLIC_EXCHANGE_AGE_UNAVAILABLE');
  else if (ageMs < -maxClockLeadMs) reasons.push('PUBLIC_EXCHANGE_EVENT_TIME_IN_FUTURE');
  else if (ageMs > 30_000) reasons.push('PUBLIC_EXCHANGE_EVENT_TOO_OLD_TO_QUALIFY_CLOCK');
  if (Number.isFinite(eventMs) && Number.isFinite(receiveMs) && Number.isFinite(ageMs) &&
      Math.abs((receiveMs - eventMs) - ageMs) > 1_000) {
    reasons.push('PUBLIC_EXCHANGE_EVENT_AGE_MISMATCH');
  }

  const comparableToReceiveClock = reasons.length === 0;
  return Object.freeze({
    source: 'SERVER_PUBLIC_EXCHANGE_TIMESTAMP_QUALIFICATION',
    version: PUBLIC_EXCHANGE_TIMESTAMP_QUALIFICATION_VERSION,
    providerId: String(source ?? ''),
    fieldName: contract?.fieldName ?? (field || null),
    semantic: contract?.semantic ?? 'UNRESOLVED',
    docsUrl: contract?.docsUrl ?? null,
    candidateAuthority: 'EXCHANGE_EVENT_TIME',
    provenanceVerified: Boolean(contract && field === contract.fieldName && Number.isFinite(eventMs)),
    comparableToReceiveClock,
    observedBucketPattern: false,
    canEvaluateFrozenFreshness: comparableToReceiveClock,
    classification: comparableToReceiveClock ? 'EXCHANGE_EVENT_TIME_SUPPORTED' : 'UNRESOLVED',
    reasonCodes: Object.freeze(reasons),
    quoteAgeMs: Number.isFinite(ageMs) ? ageMs : null,
    maxClockLeadMs,
    freshnessContractMs: 30_000,
    decisionImpact: 'NONE',
    prospectivePaperAuthorized: false,
    ordersExecuted: 0,
    externalProviderCalls: 0
  });
}
