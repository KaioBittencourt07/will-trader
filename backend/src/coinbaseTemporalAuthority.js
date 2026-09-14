import { qualifyTemporalAuthorityObservation } from './temporalAuthorityProvider.js';

export const COINBASE_TEMPORAL_AUTHORITY_VERSION = 'coinbase-exchange-ticker-temporal-v3';
export const COINBASE_TEMPORAL_MAX_SKEW_MS = 5_000;
export const COINBASE_TEMPORAL_MIN_OBSERVATIONS = 4;

const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value));
const canonical = (value) => String(value || '').trim().toUpperCase();

export const COINBASE_TEMPORAL_PRODUCTS = Object.freeze({
  'BTC/USD': 'BTC-USD',
  'ETH/USD': 'ETH-USD',
  'SOL/USD': 'SOL-USD',
  'XRP/USD': 'XRP-USD'
});

export function coinbaseProductFor(symbol = 'BTC/USD') {
  const normalized = canonical(symbol);
  const product = COINBASE_TEMPORAL_PRODUCTS[normalized];
  if (product) return product;
  throw new Error('COINBASE_TEMPORAL_SYMBOL_UNQUALIFIED');
}

export function parseCoinbasePreciseTime(value) {
  const raw = String(value || '').trim();
  const eventTimestamp = Date.parse(raw);
  if (!Number.isFinite(eventTimestamp)) throw new Error('COINBASE_TICKER_EVENT_TIME_MISSING');

  const match = raw.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/i);
  if (!match) {
    return Object.freeze({
      raw,
      eventTimestamp,
      secondTimestamp: Math.floor(eventTimestamp / 1000) * 1000,
      fractionNanoseconds: (eventTimestamp % 1000) * 1_000_000,
      precisionKey: `${Math.floor(eventTimestamp / 1000) * 1000}:${String((eventTimestamp % 1000) * 1_000_000).padStart(9, '0')}`,
      precisionDigits: 3
    });
  }

  const secondTimestamp = Date.parse(`${match[1]}Z`);
  const fraction = String(match[2] || '').slice(0, 9);
  const paddedFraction = fraction.padEnd(9, '0');
  const fractionNanoseconds = Number(paddedFraction || '0');

  return Object.freeze({
    raw,
    eventTimestamp,
    secondTimestamp,
    fractionNanoseconds,
    precisionKey: `${secondTimestamp}:${paddedFraction}`,
    precisionDigits: fraction.length
  });
}

function comparePreciseTime(left, right) {
  if (left.eventTimeSecondTimestamp !== right.eventTimeSecondTimestamp) {
    return left.eventTimeSecondTimestamp - right.eventTimeSecondTimestamp;
  }
  return left.eventTimeFractionNanoseconds - right.eventTimeFractionNanoseconds;
}

function identityProgress(previous, current) {
  const sequenceComparable = finite(previous.sequence) && finite(current.sequence);
  const tradeComparable = finite(previous.tradeId) && finite(current.tradeId);
  const sequenceDelta = sequenceComparable ? Number(current.sequence) - Number(previous.sequence) : null;
  const tradeDelta = tradeComparable ? Number(current.tradeId) - Number(previous.tradeId) : null;
  const regressed = (sequenceDelta !== null && sequenceDelta < 0) || (tradeDelta !== null && tradeDelta < 0);
  const advanced = (sequenceDelta !== null && sequenceDelta > 0) || (tradeDelta !== null && tradeDelta > 0);
  return { sequenceDelta, tradeDelta, regressed, advanced };
}

export function observationFromCoinbaseTicker({ payload, receivedAt, canonicalSymbol = 'BTC/USD' } = {}) {
  const expectedProduct = coinbaseProductFor(canonicalSymbol);
  if (payload?.type !== 'ticker') throw new Error('COINBASE_TICKER_TYPE_INVALID');
  if (canonical(payload?.product_id) !== expectedProduct) throw new Error('COINBASE_TICKER_SYMBOL_MISMATCH');
  const preciseTime = parseCoinbasePreciseTime(payload?.time);
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
    eventTimestamp: preciseTime.eventTimestamp,
    eventTimeRaw: preciseTime.raw,
    eventTimeSecondTimestamp: preciseTime.secondTimestamp,
    eventTimeFractionNanoseconds: preciseTime.fractionNanoseconds,
    eventTimePrecisionKey: preciseTime.precisionKey,
    eventTimePrecisionDigits: preciseTime.precisionDigits,
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
    .filter((item) => item
      && finite(item.eventTimestamp)
      && finite(item.price)
      && Number.isFinite(Date.parse(item.receivedAt ?? ''))
      && typeof item.eventTimePrecisionKey === 'string')
    .map((item) => ({
      ...item,
      eventTimestamp: Number(item.eventTimestamp),
      price: Number(item.price),
      receivedAtMs: Date.parse(item.receivedAt)
    }));

  let timestampRegressions = 0;
  let sequenceRegressions = 0;
  let tradeIdRegressions = 0;
  let exactTimestampIdentityConflicts = 0;
  let exactTimestampDistinctEvents = 0;
  let progressions = 0;
  let subMillisecondProgressions = 0;
  let maxAbsEventReceiveSkewMs = 0;
  const distinctPrecise = new Set();
  const distinctMilliseconds = new Set();

  for (let i = 0; i < valid.length; i += 1) {
    const current = valid[i];
    distinctPrecise.add(current.eventTimePrecisionKey);
    distinctMilliseconds.add(current.eventTimestamp);
    maxAbsEventReceiveSkewMs = Math.max(maxAbsEventReceiveSkewMs, Math.abs(current.receivedAtMs - current.eventTimestamp));
    if (i === 0) continue;
    const previous = valid[i - 1];
    const preciseOrder = comparePreciseTime(current, previous);
    const identity = identityProgress(previous, current);
    if (preciseOrder < 0) timestampRegressions += 1;
    if (finite(current.sequence) && finite(previous.sequence) && Number(current.sequence) < Number(previous.sequence)) sequenceRegressions += 1;
    if (finite(current.tradeId) && finite(previous.tradeId) && Number(current.tradeId) < Number(previous.tradeId)) tradeIdRegressions += 1;
    if (preciseOrder > 0) {
      progressions += 1;
      if (current.eventTimestamp === previous.eventTimestamp) subMillisecondProgressions += 1;
    }
    if (preciseOrder === 0 && current.price !== previous.price) {
      if (!identity.regressed && identity.advanced) exactTimestampDistinctEvents += 1;
      else exactTimestampIdentityConflicts += 1;
    }
  }

  const enoughObservations = valid.length >= Math.max(2, Number(minimumObservations) || COINBASE_TEMPORAL_MIN_OBSERVATIONS);
  const timestampProgresses = progressions > 0 && distinctPrecise.size >= 2;
  const receiveClockCoherent = valid.length > 0 && maxAbsEventReceiveSkewMs <= maxSkewMs;
  const coarseTimestampObserved = exactTimestampIdentityConflicts > 0;
  const perEventSemanticsVerified = enoughObservations
    && timestampProgresses
    && timestampRegressions === 0
    && sequenceRegressions === 0
    && tradeIdRegressions === 0
    && exactTimestampIdentityConflicts === 0
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
    'OFFICIAL_DOCS_TICKER_REALTIME_ON_MATCH_WITH_SUBSECOND_TIME_FIELD',
    ...(subMillisecondProgressions ? ['COINBASE_SUB_MILLISECOND_EVENT_TIME_OBSERVED'] : []),
    ...(exactTimestampDistinctEvents ? ['COINBASE_EXACT_TIMESTAMP_DISTINCT_EVENTS_DISAMBIGUATED_BY_EVENT_IDENTITY'] : []),
    ...(enoughObservations ? [] : ['COINBASE_TICKER_OBSERVATIONS_INSUFFICIENT']),
    ...(timestampProgresses ? [] : ['COINBASE_TICKER_TIMESTAMP_DID_NOT_PROGRESS']),
    ...(timestampRegressions ? ['COINBASE_TICKER_TIMESTAMP_REGRESSION'] : []),
    ...(sequenceRegressions ? ['COINBASE_TICKER_SEQUENCE_REGRESSION'] : []),
    ...(tradeIdRegressions ? ['COINBASE_TICKER_TRADE_ID_REGRESSION'] : []),
    ...(exactTimestampIdentityConflicts ? ['COINBASE_TICKER_EXACT_TIMESTAMP_IDENTITY_CONFLICT'] : []),
    ...(receiveClockCoherent ? [] : ['COINBASE_TICKER_EVENT_RECEIVE_SKEW_TOO_LARGE'])
  ];

  return Object.freeze({
    version: COINBASE_TEMPORAL_AUTHORITY_VERSION,
    source: 'COINBASE_OFFICIAL_EXCHANGE_TICKER_DOCUMENTATION_PLUS_RUNTIME_OBSERVATION',
    channel: 'ticker',
    symbol: latest?.symbol ?? null,
    providerProduct: latest?.providerProduct ?? null,
    timestampField: 'time',
    eventIdentityFields: Object.freeze(['sequence', 'trade_id']),
    timestampPrecisionPolicy: 'PRESERVE_PROVIDER_SUBSECOND_PRECISION_FOR_ORDERING;ALLOW_EQUAL_EVENT_TIME_ONLY_WHEN_EVENT_IDENTITY_ADVANCES;EPOCH_MS_ONLY_FOR_FRESHNESS',
    semanticClassification: perEventSemanticsVerified
      ? 'PROVIDER_PER_MATCH_EVENT_TIME_OBSERVED'
      : coarseTimestampObserved
        ? 'PROVIDER_EVENT_TIME_IDENTITY_CONFLICT_OBSERVED'
        : 'PROVIDER_EVENT_TIME_SEMANTICS_UNVERIFIED',
    semanticReasonCodes: Object.freeze(semanticReasonCodes),
    fieldProvenanceVerified: true,
    provenanceVerified: perEventSemanticsVerified,
    perEventFreshnessSemanticsVerified: perEventSemanticsVerified,
    comparableToReceiveClock: perEventSemanticsVerified,
    canEvaluateFrozenFreshness: perEventSemanticsVerified,
    observation: Object.freeze({
      acceptedObservations: valid.length,
      distinctEventTimestamps: distinctPrecise.size,
      distinctMillisecondTimestamps: distinctMilliseconds.size,
      timestampProgressions: progressions,
      subMillisecondProgressions,
      exactTimestampDistinctEvents,
      repeatedTimestampPriceChanges: exactTimestampIdentityConflicts,
      exactTimestampIdentityConflicts,
      timestampRegressions,
      sequenceRegressions,
      tradeIdRegressions,
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
