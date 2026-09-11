export const ANALYZE_TEMPORAL_ADMISSION_VERSION = 'analyze-temporal-admission-v1';

export function evaluateAnalyzeTemporalAdmission(market, context = {}) {
  const required = context?.requireAuthoritativeFreshness === true;
  const freshness = market?.authoritativeFreshness;

  if (!required) {
    return Object.freeze({
      version: ANALYZE_TEMPORAL_ADMISSION_VERSION,
      required: false,
      allowed: true,
      mode: 'LEGACY_COMPATIBILITY',
      authorityGate: freshness?.authorityGate ?? 'UNVERIFIED',
      freshnessGate: freshness?.freshnessGate ?? 'UNVERIFIED',
      blocker: null,
      decisionImpact: 'LEGACY_ONLY'
    });
  }

  if (!freshness || typeof freshness !== 'object') {
    return Object.freeze({
      version: ANALYZE_TEMPORAL_ADMISSION_VERSION,
      required: true,
      allowed: false,
      mode: 'AUTHORITATIVE_FRESHNESS_REQUIRED',
      authorityGate: 'FAIL',
      freshnessGate: 'UNVERIFIED',
      blocker: 'AUTHORITATIVE_FRESHNESS_MISSING',
      decisionImpact: 'BLOCK'
    });
  }

  if (freshness.authorityGate !== 'PASS') {
    return Object.freeze({
      version: ANALYZE_TEMPORAL_ADMISSION_VERSION,
      required: true,
      allowed: false,
      mode: 'AUTHORITATIVE_FRESHNESS_REQUIRED',
      authorityGate: freshness.authorityGate ?? 'FAIL',
      freshnessGate: freshness.freshnessGate ?? 'UNVERIFIED',
      blocker: 'TIMESTAMP_AUTHORITY_NOT_APPROVED',
      decisionImpact: 'BLOCK'
    });
  }

  if (freshness.freshnessGate !== 'PASS') {
    return Object.freeze({
      version: ANALYZE_TEMPORAL_ADMISSION_VERSION,
      required: true,
      allowed: false,
      mode: 'AUTHORITATIVE_FRESHNESS_REQUIRED',
      authorityGate: 'PASS',
      freshnessGate: freshness.freshnessGate ?? 'UNVERIFIED',
      blocker: 'AUTHORITATIVE_FRESHNESS_NOT_APPROVED',
      decisionImpact: 'BLOCK'
    });
  }

  return Object.freeze({
    version: ANALYZE_TEMPORAL_ADMISSION_VERSION,
    required: true,
    allowed: true,
    mode: 'AUTHORITATIVE_FRESHNESS_REQUIRED',
    authorityGate: 'PASS',
    freshnessGate: 'PASS',
    blocker: null,
    decisionImpact: 'ALLOW_ANALYSIS_ONLY'
  });
}
