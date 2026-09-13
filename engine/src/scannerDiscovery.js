export const WAIT_CODES = Object.freeze({
  DATA: 'WAIT_DATA', MARKET: 'WAIT_MARKET', TIMING: 'WAIT_TIMING', CONFLICT: 'WAIT_CONFLICT',
  LOW_EDGE: 'WAIT_LOW_EDGE', STRATEGY: 'WAIT_STRATEGY', MACRO: 'WAIT_MACRO', NEWS: 'WAIT_NEWS', UNKNOWN: 'WAIT_UNKNOWN'
});

const n = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** A descriptive pre-trade feature. It is never confidence or probability. */
export function setupReadiness(snapshot = {}) {
  if (snapshot.featureStatus && snapshot.featureStatus !== 'OK') return { featureVersion: snapshot.featureVersion ?? 'legacy-unversioned', setupForming: false, readiness: 0, reasons: ['FEATURES_UNAVAILABLE'] };
  const reasons = [];
  if (snapshot.breakout || snapshot.rejection) reasons.push('PRICE_ACTION_TRIGGER');
  if (snapshot.pullbackRecovery) reasons.push('PULLBACK_RECOVERY');
  if (Math.abs(n(snapshot.trendSlopeAtr)) >= .25) reasons.push('DIRECTIONAL_SLOPE');
  if (n(snapshot.rangeCompression) <= .85 || n(snapshot.rangeExpansion) >= 1.15) reasons.push('RANGE_CHANGE');
  const readiness = Math.min(4, reasons.length);
  return { featureVersion: snapshot.featureVersion ?? 'legacy-unversioned', setupForming: readiness >= 2, readiness, reasons };
}

export function waitCode(snapshot = {}, decision = {}, context = {}) {
  if (snapshot.valid === false || ['STALE', 'INVALID', 'MARKET_DATA_UNAVAILABLE'].includes(snapshot.status)) return WAIT_CODES.DATA;
  if (snapshot.marketOpen === false || snapshot.status === 'MARKET_CLOSED') return WAIT_CODES.MARKET;
  if (context.macroBlocked) return WAIT_CODES.MACRO;
  if (context.newsBlocked) return WAIT_CODES.NEWS;
  if (decision.timing && decision.timing.valid === false) return WAIT_CODES.TIMING;
  const reasons = [...(decision.blockReasons ?? [])].join(' ').toUpperCase();
  if (/CONFLICT|VETO|DISAGREE/.test(reasons)) return WAIT_CODES.CONFLICT;
  if (/LOW_CONFIDENCE|LOW_EDGE|POUCAS CONFIRMA/.test(reasons)) return WAIT_CODES.LOW_EDGE;
  if (/UNKNOWN|DIRECTION|SETUP|REGIME/.test(reasons) || decision.direction === 'WAIT') return WAIT_CODES.STRATEGY;
  return WAIT_CODES.UNKNOWN;
}

export function assessScannerCandidate({ asset, snapshot = {}, decision = {}, context = {} } = {}) {
  const readiness = setupReadiness(snapshot);
  const dataValid = snapshot.valid !== false && snapshot.status !== 'STALE';
  const marketEligible = dataValid && snapshot.marketOpen !== false;
  const setupValid = decision.setup && decision.setup !== 'UNKNOWN';
  const executable = Boolean(decision.executable && !decision.blocked && ['BUY', 'SELL'].includes(decision.direction));
  return {
    asset: asset ?? snapshot.asset ?? null,
    stages: { observed: true, dataValid, marketEligible, setupForming: readiness.setupForming, setupValid, executable, ranked: false },
    readiness,
    waitCode: executable ? null : waitCode(snapshot, decision, context)
  };
}

/** Used only to choose scan order; it never changes a candidate's entry eligibility. */
export function adaptiveScanPriority(snapshot = {}, readiness = setupReadiness(snapshot)) {
  if (snapshot.valid === false || snapshot.marketOpen === false || snapshot.status === 'STALE') return 0;
  const freshness = Number.isFinite(Number(snapshot.ageMs)) ? clamp(1 - Number(snapshot.ageMs) / 30_000, 0, 1) : .5;
  return Math.round((readiness.setupForming ? 100 : 25) + readiness.readiness * 10 + freshness * 10);
}

export function scannerTelemetry(candidates = [], { providerRequests = null, scannedAt = new Date().toISOString() } = {}) {
  const stages = ['observed', 'dataValid', 'marketEligible', 'setupForming', 'setupValid', 'executable', 'ranked'];
  const funnel = Object.fromEntries(stages.map((stage) => [stage, candidates.filter((item) => item.stages?.[stage]).length]));
  const waits = {};
  for (const candidate of candidates) if (candidate.waitCode) waits[candidate.waitCode] = (waits[candidate.waitCode] ?? 0) + 1;
  const elapsedHour = new Date(scannedAt).toISOString().slice(0, 13);
  return { funnel, waits, sampleN: candidates.length, hour: elapsedHour, opportunitiesPerHour: funnel.setupValid, executablePerHour: funnel.executable, providerRequests, requestsPerEligibleOpportunity: funnel.setupValid > 0 && Number.isFinite(providerRequests) ? providerRequests / funnel.setupValid : null };
}
