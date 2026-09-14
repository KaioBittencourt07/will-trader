import crypto from 'node:crypto';

export const CANONICAL_MARKET_SNAPSHOT_VERSION = 'canonical-market-snapshot-v1';
export const CANONICAL_STUDY_FINGERPRINT_VERSION = 'canonical-study-fingerprint-v1';

const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value));
const canonical = (value) => String(value || '').trim().toUpperCase();
const validTime = (value) => Number.isFinite(Date.parse(value ?? ''));

function normalizeCandle(bar = {}) {
  const timestamp = bar.timestamp ?? bar.datetime ?? bar.time ?? bar.Time ?? null;
  return Object.freeze({
    timestamp: validTime(timestamp) ? new Date(Date.parse(timestamp)).toISOString() : null,
    open: finite(bar.open ?? bar.Open) ? Number(bar.open ?? bar.Open) : null,
    high: finite(bar.high ?? bar.High) ? Number(bar.high ?? bar.High) : null,
    low: finite(bar.low ?? bar.Low) ? Number(bar.low ?? bar.Low) : null,
    close: finite(bar.close ?? bar.Close) ? Number(bar.close ?? bar.Close) : null
  });
}

function validOhlc(bar) {
  if (!bar?.timestamp || ![bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)) return false;
  return bar.high >= Math.max(bar.open, bar.close)
    && bar.low <= Math.min(bar.open, bar.close)
    && bar.high >= bar.low;
}

export function buildCanonicalMarketSnapshot({ snapshot = {}, admission = null, now = Date.now(), requiredBars = 50 } = {}) {
  const reasons = [];
  const asset = canonical(snapshot.asset);
  const timeframe = String(snapshot.timeframe || '').trim();
  const temporal = snapshot.authoritativeFreshness ?? null;
  const admissionProof = admission ?? snapshot.marketAdmission ?? snapshot.admissionProof ?? null;

  if (!asset) reasons.push('CANONICAL_ASSET_MISSING');
  if (!timeframe) reasons.push('CANONICAL_TIMEFRAME_MISSING');
  if (!finite(snapshot.price) || Number(snapshot.price) <= 0) reasons.push('CANONICAL_PRICE_INVALID');
  if (!snapshot.featureVersion) reasons.push('CANONICAL_FEATURE_VERSION_MISSING');

  if (admissionProof?.state !== 'ADMITTED') reasons.push('CANONICAL_ADMISSION_NOT_PROVEN');
  if (admissionProof?.version !== 'market-admission-gate-v1') reasons.push('CANONICAL_ADMISSION_VERSION_UNSUPPORTED');

  if (temporal?.authorityGate !== 'PASS' || temporal?.freshnessGate !== 'PASS') reasons.push('CANONICAL_TEMPORAL_AUTHORITY_NOT_APPROVED');
  if (!temporal?.timestampAuthority || temporal.timestampAuthority === 'UNRESOLVED') reasons.push('CANONICAL_TIMESTAMP_AUTHORITY_UNRESOLVED');
  if (Number(temporal?.freshnessContractMs) !== 30_000) reasons.push('CANONICAL_FRESHNESS_CONTRACT_MISMATCH');
  if (!finite(temporal?.eventTimestamp)) reasons.push('CANONICAL_EVENT_TIME_MISSING');
  if (finite(temporal?.eventTimestamp)) {
    const age = Number(now) - Number(temporal.eventTimestamp);
    if (age < -1_000 || age > 30_000) reasons.push('CANONICAL_EVENT_TIME_OUTSIDE_FROZEN_WINDOW');
  }

  const completeness = snapshot.candleCompleteness ?? null;
  const latestClosed = snapshot.latestClosedCandleTimestamp ?? null;
  if (completeness !== 'VERIFIED_CLOSED_BY_DOCUMENTED_CHART_CONTEXT') reasons.push('CANONICAL_CLOSED_CANDLE_PROOF_MISSING');
  if (!validTime(latestClosed)) reasons.push('CANONICAL_LATEST_CLOSED_CANDLE_TIME_INVALID');

  const normalizedCandles = (Array.isArray(snapshot.candles) ? snapshot.candles : [])
    .map(normalizeCandle)
    .filter(validOhlc)
    .filter((bar) => !validTime(latestClosed) || Date.parse(bar.timestamp) <= Date.parse(latestClosed))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  if (normalizedCandles.length < Number(requiredBars)) reasons.push('CANONICAL_CLOSED_BARS_INSUFFICIENT');
  if (normalizedCandles.length && validTime(latestClosed) && normalizedCandles.at(-1).timestamp !== new Date(Date.parse(latestClosed)).toISOString()) {
    reasons.push('CANONICAL_LAST_BAR_DOES_NOT_MATCH_CLOSED_PROOF');
  }

  const state = reasons.length ? 'REJECTED' : 'READY';
  return Object.freeze({
    version: CANONICAL_MARKET_SNAPSHOT_VERSION,
    state,
    valid: state === 'READY',
    reasons: Object.freeze([...new Set(reasons)]),
    asset,
    timeframe,
    price: finite(snapshot.price) ? Number(snapshot.price) : null,
    eventTimestamp: finite(temporal?.eventTimestamp) ? Number(temporal.eventTimestamp) : null,
    timestampAuthority: temporal?.timestampAuthority ?? 'UNRESOLVED',
    freshnessContractMs: 30_000,
    featureVersion: snapshot.featureVersion ?? null,
    source: snapshot.source ?? null,
    closedCandles: Object.freeze(normalizedCandles),
    latestClosedCandleTimestamp: validTime(latestClosed) ? new Date(Date.parse(latestClosed)).toISOString() : null,
    admissionProof: admissionProof ? Object.freeze({ version: admissionProof.version ?? null, state: admissionProof.state ?? null }) : null,
    provenance: Object.freeze({
      marketSource: snapshot.source ?? null,
      quoteTimestampOrigin: snapshot.timestampOrigins?.quoteTimestamp ?? null,
      candleTimestampOrigin: snapshot.timestampOrigins?.candleTimestamp ?? null,
      timestampAuthority: temporal?.timestampAuthority ?? null
    }),
    decisionImpact: 'ANALYSIS_INPUT_ONLY',
    ordersExecuted: 0
  });
}

export function createCanonicalStudyFingerprint(canonicalSnapshot = {}) {
  if (canonicalSnapshot?.valid !== true || canonicalSnapshot?.state !== 'READY') {
    return Object.freeze({ version: CANONICAL_STUDY_FINGERPRINT_VERSION, eligible: false, hash: null, reason: 'CANONICAL_SNAPSHOT_NOT_READY' });
  }
  const lastBars = canonicalSnapshot.closedCandles.slice(-12).map((bar) => [bar.timestamp, bar.open, bar.high, bar.low, bar.close]);
  const payload = JSON.stringify({
    version: CANONICAL_STUDY_FINGERPRINT_VERSION,
    asset: canonicalSnapshot.asset,
    timeframe: canonicalSnapshot.timeframe,
    featureVersion: canonicalSnapshot.featureVersion,
    timestampAuthority: canonicalSnapshot.timestampAuthority,
    latestClosedCandleTimestamp: canonicalSnapshot.latestClosedCandleTimestamp,
    lastBars
  });
  return Object.freeze({
    version: CANONICAL_STUDY_FINGERPRINT_VERSION,
    eligible: true,
    hash: crypto.createHash('sha256').update(payload).digest('hex')
  });
}
