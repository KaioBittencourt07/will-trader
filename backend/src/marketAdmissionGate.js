import { attachMarketAuthoritativeFreshness } from './marketAuthoritativeFreshness.js';
import { evaluateAnalyzeTemporalAdmission } from './analyzeTemporalAdmission.js';

export const MARKET_ADMISSION_GATE_VERSION = 'market-admission-gate-v1';

const invalidStatuses = new Set(['STALE', 'MARKET_CLOSED', 'DATA_INVALID', 'INVALID']);

function featureReady(snapshot = {}) {
  const featureVersion = snapshot.featureVersion ?? null;
  const candleCount = Number(snapshot.candleCount ?? snapshot.candles?.length ?? 0);
  const requiredBars = Number(snapshot.requiredBars ?? 50);
  return Boolean(featureVersion) && Number.isFinite(candleCount) && candleCount >= requiredBars;
}

export function evaluateMarketAdmission(snapshot = {}, { requireAuthoritativeFreshness = true } = {}) {
  const reasons = [];
  const enriched = snapshot?.authoritativeFreshness ? snapshot : attachMarketAuthoritativeFreshness(snapshot);
  const qualityStatus = String(enriched?.status ?? '').toUpperCase();

  const shapeValid = Boolean(
    enriched &&
    typeof enriched === 'object' &&
    enriched.asset &&
    enriched.timeframe &&
    Number.isFinite(Number(enriched.price)) &&
    Number(enriched.price) > 0 &&
    Number.isFinite(Date.parse(enriched.timestamp ?? ''))
  );
  if (!shapeValid) reasons.push('SNAPSHOT_SHAPE_INVALID');

  const marketOpen = enriched?.marketOpen !== false;
  if (!marketOpen) reasons.push('MARKET_CLOSED');

  const dataValid = enriched?.valid !== false && !invalidStatuses.has(qualityStatus);
  if (!dataValid) reasons.push(enriched?.reason || qualityStatus || 'MARKET_DATA_INVALID');

  const featuresReady = featureReady(enriched);
  if (!featuresReady) reasons.push('FEATURES_NOT_READY');

  const temporal = evaluateAnalyzeTemporalAdmission(enriched, {
    requireAuthoritativeFreshness
  });
  if (!temporal.allowed && temporal.blocker) reasons.push(temporal.blocker);

  const admitted = shapeValid && marketOpen && dataValid && featuresReady && temporal.allowed;

  return Object.freeze({
    version: MARKET_ADMISSION_GATE_VERSION,
    admitted,
    state: admitted ? 'ADMITTED' : 'REJECTED',
    stage: admitted ? 'DATA_ADMITTED' : 'RAW_OBSERVATION',
    snapshot: enriched,
    checks: Object.freeze({
      shapeValid,
      marketOpen,
      dataValid,
      featuresReady,
      authoritativeFreshnessRequired: requireAuthoritativeFreshness,
      timestampAuthority: enriched?.authoritativeFreshness?.timestampAuthority ?? 'UNRESOLVED',
      authorityGate: enriched?.authoritativeFreshness?.authorityGate ?? 'UNVERIFIED',
      freshnessGate: enriched?.authoritativeFreshness?.freshnessGate ?? 'UNVERIFIED'
    }),
    reasons: Object.freeze([...new Set(reasons)])
  });
}
