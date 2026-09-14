import { qualifyTemporalAuthorityObservation } from './temporalAuthorityProvider.js';

export const COINBASE_TEMPORAL_AUTHORITY_VERSION = 'coinbase-exchange-ticker-temporal-v1';
export const COINBASE_TEMPORAL_MAX_SKEW_MS = 5_000;
export const COINBASE_TEMPORAL_MIN_OBSERVATIONS = 4;

const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value));
const canonical = (value) => String(value || '').trim().toUpperCase();

export function coinbaseProductFor(symbol = 'BTC/USD') {
  const normalized = canonical(symbol);
  if (normalized === 'BTC/USD') return 'BTC-USD';
  throw new Error('COINBASE_TEMPORAL_SYMBOL_UNQUALIFIED');
}

export function observationFromCoinbaseTicker({ payload, receivedAt, canonicalSymbol = 'BTC/USD' } = {}) {
  const expectedProduct = coinbaseProductFor(canonicalSymbol);
  if (payload?.type !== 'ticker') throw new Error('COINBASE_TICKER_TYPE_INVALID');
  if (canonical(payload?.product_id) !== expectedProduct) throw new Error('COINBASE_TICKER_SYMBOL_MISMATCH');
  const eventTimestamp = Date.parse(payload?.time ?? '');
  if (!Number.isFinite(eventTimestamp)) throw new Error('COINBASE_TICKER_EVENT_TIME_MISSING');
  if (!Number.isFinite(Date.parse(receivedAt ?? ''))) throw new Error('COINBASE_TICKER_RECEIVED_AT_MISSING');
  const price = finite(payload?.price) ? Number(payload.price) : null;
  if (price === null || price <= 0) throw new Error('COINBASE_TICKER_PRICE_INVALID');
  const sequence = finite(payload?.sequence) ? Number(payload.sequence) : null;
  const tradeId = finite(payload?.trade_id) ? Number(payload.trade_id) : null;
  return Object.freeze({
    provider: 'coinbase-exchange-ticker',
    source: 'coinbase-exchange-ticker',
    symbol: canonical(canonicalSymbol),
    providerProduct: expectedProduct,
    price,
    eventTimestamp,
    receivedAt: new Date(Date.parse(receivedAt)).toISOString(),
    sequence,
    tradeId,
    timestampAuthority: 'COINBASE_EXCHANGE_TICKER_MATCH_TIME',
    provenanceVerified: true,
    perEventSemanticsVerified: false,
    decisionImpact: 'NONE',
    ordersExecuted: 0
  });
}

export function qualifyCoinbaseTickerSeries({
  observations = [],
  now = Date.now(),
  maxSkewMs = COINBASE_TEMPORAL_MAX_SKEW_MS,
  minimumObservations = COINBASE_TEMPORAL_MIN_OBSERVATIONS
} = {}) {
  const valid = observations
    .filter((item) => item && finite(item.eventTimestamp) && finite(item.price) && Number.isFinite(Date.parse(item.receivedAt ?? '')))
    .map((item) => ({ ...item, eventTimestamp: Number(item.eventTimestamp), price: Number(item.price), receivedAtMs: Date.parse(item.receivedAt) }));

  let timestampRegressions = 0;
  let sequenceRegressions = 0;
  let repeatedTimestampPriceChanges = 0;
  let progressions = 0;
  let maxAbsEventReceiveSkewMs = 0;
  const distinct = new Set();

  for (let i = 0; i < valid.length; i += 1) {
    const current = valid[i];
    distinct.add(current.eventTimestamp);
    maxAbsEventReceiveSkewMs = Math.max(maxAbsEventReceiveSkewMs, Math.abs(current.receivedAtMs - current.eventTimestamp));
    if (i === 0) continue;
    const previous = valid[i - 1];
    if (current.eventTimestamp < previous.eventTimestamp) timestampRegressions += 1;
    if (current.eventTimestamp > previous.eventTimestamp) progressions += 1;
    if (current.eventTimestamp === previous.eventTimestamp && current.price !== previous.price) repeatedTimestampPriceChanges += 1;
    if (finite(current.sequence) && finite(previous.sequence) && Number(current.sequence) < Number(previous.sequence)) sequenceRegressions += 1;
  }

  const enoughObservations = valid.length >= Math.max(2, Number(minimumObservations) || COINBASE_TEMPORAL_MIN_OBSERVATIONS);
  const timestampProgresses = progressions > 0 && distinct.size >= 2;
  const receiveClockCoherent = valid.length > 0 && maxAbsEventReceiveSkewMs <= maxSkewMs;
  const coarseTimestampObserved = repeatedTimestampPriceChanges > 0;
  const perEventSemanticsVerified = enoughObservations
    && timestampProgresses
    && timestampRegressions === 0
    && sequenceRegressions === 0
    && repeatedTimestampPriceChanges === 0
    && receiveClockCoherent;

  const latest = valid.at(-1) ?? null;
  const authority = latest ? qualifyTemporalAuthorityObservation({
    provider: 'coinbase-exchange-ticker',
    symbol: latest.symbol,
    eventTimestamp: latest.eventTimestamp,
    receivedAt: new Date(latest.receivedAtMs).toISOString(),
    timestampAuthority: 'COINBASE_EXCHANGE_TICKER_MATCH_TIME',
    provenanceVerified: true,
    perEventSemanticsVerified,
    now
  }) : null;

  const semanticReasonCodes = [
    'OFFICIAL_DOCS_TICKER_REALTIME_ON_MATCH_WITH_TIME_FIELD',
    ...(enoughObservations ? [] : ['COINBASE_TICKER_OBSERVATIONS_INSUFFICIENT']),
    ...(timestampProgresses ? [] : ['COINBASE_TICKER_TIMESTAMP_DID_NOT_PROGRESS']),
    ...(timestampRegressions ? ['COINBASE_TICKER_TIMESTAMP_REGRESSION'] : []),
    ...(sequenceRegressions ? ['COINBASE_TICKER_SEQUENCE_REGRESSION'] : []),
    ...(repeatedTimestampPriceChanges ? ['COINBASE_TICKER_PRICE_CHANGES_SHARE_TIMESTAMP'] : []),
    ...(receiveClockCoherent ? [] : ['COINBASE_TICKER_EVENT_RECEIVE_SKEW_TOO_LARGE'])
  ];

  return Object.freeze({
    version: COINBASE_TEMPORAL_AUTHORITY_VERSION,
    source: 'COINBASE_OFFICIAL_EXCHANGE_TICKER_DOCUMENTATION_PLUS_RUNTIME_OBSERVATION',
    channel: 'ticker',
    symbol: latest?.symbol ?? null,
    providerProduct: latest?.providerProduct ?? null,
    timestampField: 'time',
    semanticClassification: perEventSemanticsVerified
      ? 'PROVIDER_PER_MATCH_EVENT_TIME_OBSERVED'
      : coarseTimestampObserved
        ? 'PROVIDER_COARSE_OR_BUCKETED_EVENT_TIME_OBSERVED'
        : 'PROVIDER_EVENT_TIME_SEMANTICS_UNVERIFIED',
    semanticReasonCodes: Object.freeze(semanticReasonCodes),
    fieldProvenanceVerified: true,
    provenanceVerified: perEventSemanticsVerified,
    perEventFreshnessSemanticsVerified: perEventSemanticsVerified,
    comparableToReceiveClock: perEventSemanticsVerified,
    canEvaluateFrozenFreshness: perEventSemanticsVerified,
    observation: Object.freeze({
      acceptedObservations: valid.length,
      distinctEventTimestamps: distinct.size,
      timestampProgressions: progressions,
      repeatedTimestampPriceChanges,
      timestampRegressions,
      sequenceRegressions,
      maxAbsEventReceiveSkewMs,
      maximumAllowedEventReceiveSkewMs: maxSkewMs,
      enoughObservations,
      timestampProgresses,
      receiveClockCoherent,
      coarseTimestampObserved
    }),
    temporalAuthority: authority,
    decisionImpact: 'NONE',
    ordersExecuted: 0
  });
}
