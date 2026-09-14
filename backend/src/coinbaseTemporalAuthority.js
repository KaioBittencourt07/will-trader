import { qualifyTemporalAuthorityObservation } from './temporalAuthorityProvider.js';

export const COINBASE_TEMPORAL_AUTHORITY_VERSION = 'coinbase-exchange-ticker-temporal-v2';
export const COINBASE_TEMPORAL_MAX_SKEW_MS = 5_000;
export const COINBASE_TEMPORAL_MIN_OBSERVATIONS = 4;

const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value));
const canonical = (value) => String(value || '').trim().toUpperCase();

export function coinbaseProductFor(symbol = 'BTC/USD') {
  const normalized = canonical(symbol);
  if (normalized === 'BTC/USD') return 'BTC-USD';
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
  let repeatedTimestampPriceChanges = 0;
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
    if (preciseOrder < 0) timestampRegressions += 1;
    if (preciseOrder > 0) {
      progressions += 1;
      if (current.eventTimestamp === previous.eventTimestamp) subMillisecondProgressions += 1;
    }
    if (preciseOrder === 0 && current.price !== previous.price) repeatedTimestampPriceChanges += 1;
    if (finite(current.sequence) && finite(previous.sequence) && Number(current.sequence) < Number(previous.sequence)) sequenceRegressions += 1;
  }

  const enoughObservations = valid.length >= Math.max(2, Number(minimumObservations) || COINBASE_TEMPORAL_MIN_OBSERVATIONS);
  const timestampProgresses = progressions > 0 && distinctPrecise.size >= 2;
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
    'OFFICIAL_DOCS_TICKER_REALTIME_ON_MATCH_WITH_SUBSECOND_TIME_FIELD',
    ...(subMillisecondProgressions ? ['COINBASE_SUB_MILLISECOND_EVENT_TIME_OBSERVED'] : []),
    ...(enoughObservations ? [] : ['COINBASE_TICKER_OBSERVATIONS_INSUFFICIENT']),
    ...(timestampProgresses ? [] : ['COINBASE_TICKER_TIMESTAMP_DID_NOT_PROGRESS']),
    ...(timestampRegressions ? ['COINBASE_TICKER_TIMESTAMP_REGRESSION'] : []),
    ...(sequenceRegressions ? ['COINBASE_TICKER_SEQUENCE_REGRESSION'] : []),
    ...(repeatedTimestampPriceChanges ? ['COINBASE_TICKER_PRICE_CHANGES_SHARE_EXACT_TIMESTAMP'] : []),
    ...(receiveClockCoherent ? [] : ['COINBASE_TICKER_EVENT_RECEIVE_SKEW_TOO_LARGE'])
  ];

  return Object.freeze({
    version: COINBASE_TEMPORAL_AUTHORITY_VERSION,
    source: 'COINBASE_OFFICIAL_EXCHANGE_TICKER_DOCUMENTATION_PLUS_RUNTIME_OBSERVATION',
    channel: 'ticker',
    symbol: latest?.symbol ?? null,
    providerProduct: latest?.providerProduct ?? null,
    timestampField: 'time',
    timestampPrecisionPolicy: 'PRESERVE_PROVIDER_SUBSECOND_PRECISION_FOR_ORDERING;EPOCH_MS_ONLY_FOR_FRESHNESS',
    semanticClassification: perEventSemanticsVerified
      ? 'PROVIDER_PER_MATCH_EVENT_TIME_OBSERVED'
      : coarseTimestampObserved
        ? 'PROVIDER_EXACT_EVENT_TIME_COLLISION_OBSERVED'
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
