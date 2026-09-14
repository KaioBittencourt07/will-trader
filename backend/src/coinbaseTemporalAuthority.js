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
    tradeId
  });
}

export function qualifyCoinbaseTickerSeries({ observations = [], now = Date.now() } = {}) {
  const usable = (Array.isArray(observations) ? observations : []).filter(Boolean);
  const reasons = [];
  const identityConflicts = [];
  const regressions = [];
  const repeatedTimestampPriceChanges = [];
  const distinctPreciseTimes = new Set();
  const seenIdentity = new Map();

  for (let index = 0; index < usable.length; index += 1) {
    const current = usable[index];
    distinctPreciseTimes.add(current.eventTimePrecisionKey);
    const identityKey = `${current.sequence ?? 'null'}:${current.tradeId ?? 'null'}`;
    const priorIdentity = seenIdentity.get(identityKey);
    if (priorIdentity && (priorIdentity.price !== current.price || priorIdentity.eventTimePrecisionKey !== current.eventTimePrecisionKey)) {
      identityConflicts.push({ index, identityKey });
    }
    seenIdentity.set(identityKey, current);
    if (index === 0) continue;
    const previous = usable[index - 1];
    const temporalDelta = comparePreciseTime(previous, current);
    const progress = identityProgress(previous, current);
    if (temporalDelta < 0 || progress.regressed) regressions.push({ index, temporalDelta, ...progress });
    if (temporalDelta === 0 && previous.price !== current.price) {
      repeatedTimestampPriceChanges.push({ index, identityAdvanced: progress.advanced });
    }
  }

  if (usable.length < COINBASE_TEMPORAL_MIN_OBSERVATIONS) reasons.push('COINBASE_OBSERVATIONS_INSUFFICIENT');
  if (identityConflicts.length) reasons.push('COINBASE_IDENTITY_CONFLICT');
  if (regressions.length) reasons.push('COINBASE_EVENT_SEQUENCE_REGRESSION');
  if (repeatedTimestampPriceChanges.some((entry) => !entry.identityAdvanced)) reasons.push('COINBASE_EQUAL_TIME_WITHOUT_IDENTITY_PROGRESS');

  const latest = usable.at(-1) ?? null;
  const latestEventMs = latest?.eventTimestamp;
  const eventAgeMs = Number.isFinite(latestEventMs) ? Number(now) - latestEventMs : null;
  const maxObservedSkewMs = usable.length
    ? Math.max(...usable.map((entry) => Math.abs(Date.parse(entry.receivedAt) - entry.eventTimestamp)))
    : null;
  if (maxObservedSkewMs !== null && maxObservedSkewMs > COINBASE_TEMPORAL_MAX_SKEW_MS) reasons.push('COINBASE_RECEIVE_EVENT_SKEW_TOO_HIGH');

  const canEvaluateFrozenFreshness = reasons.length === 0 && latest !== null;
  const temporalAuthority = canEvaluateFrozenFreshness
    ? qualifyTemporalAuthorityObservation({
        timestampAuthority: 'COINBASE_EXCHANGE_TICKER_MATCH_TIME',
        eventTimestamp: latest.eventTimestamp,
        receivedAt: Date.parse(latest.receivedAt),
        now,
        freshnessContractMs: 30_000,
        provenanceVerified: true,
        comparableToReceiveClock: true
      })
    : Object.freeze({
        timestampAuthority: 'COINBASE_EXCHANGE_TICKER_MATCH_TIME',
        authorityGate: 'FAIL',
        freshnessGate: 'UNVERIFIED',
        freshnessContractMs: 30_000,
        eventTimestamp: latestEventMs ?? null,
        eventAgeMs,
        reasonCodes: Object.freeze([...new Set(reasons)]),
        canEvaluateFrozenFreshness: false
      });

  return Object.freeze({
    version: COINBASE_TEMPORAL_AUTHORITY_VERSION,
    observations: usable.length,
    distinctPreciseEventTimestamps: distinctPreciseTimes.size,
    repeatedTimestampPriceChanges: repeatedTimestampPriceChanges.length,
    identityConflicts: identityConflicts.length,
    regressions: regressions.length,
    maxObservedSkewMs,
    eventAgeMs,
    reasons: Object.freeze([...new Set(reasons)]),
    canEvaluateFrozenFreshness,
    temporalAuthority
  });
}
