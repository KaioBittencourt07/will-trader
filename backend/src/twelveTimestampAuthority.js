export const TWELVE_TIMESTAMP_AUTHORITY_VERSION = 'twelve-timestamp-authority-v1';
export const FROZEN_FRESHNESS_CONTRACT_MS = 30_000;

const AUTHORITIES = new Set([
  'EXCHANGE_EVENT_TIME',
  'PROVIDER_EVENT_TIME',
  'PROVIDER_BUCKET_TIME',
  'CLIENT_RECEIVE_TIME',
  'UNRESOLVED'
]);

function invalid(reason) {
  return Object.freeze({
    version: TWELVE_TIMESTAMP_AUTHORITY_VERSION,
    classification: 'DATA_INVALID',
    reasonCodes: Object.freeze([reason]),
    freshnessContractMs: FROZEN_FRESHNESS_CONTRACT_MS,
    canEvaluateFrozenFreshness: false,
    arrivalTimeCanReplaceEventTime: false,
    bucketTimeCanBypassFreshness: false,
    providerCommissioning: false,
    decisionImpact: 'NONE',
    prospectivePaperAuthorized: false,
    ordersExecuted: 0,
    externalProviderCalls: 0
  });
}

export function classifyTwelveTimestampAuthority({
  candidateAuthority = 'UNRESOLVED',
  provenanceVerified = false,
  comparableToReceiveClock = false,
  observedBucketPattern = false,
  freshnessContractMs = FROZEN_FRESHNESS_CONTRACT_MS
} = {}) {
  if (!AUTHORITIES.has(candidateAuthority)) return invalid('TIMESTAMP_AUTHORITY_UNKNOWN');
  if (freshnessContractMs !== FROZEN_FRESHNESS_CONTRACT_MS) return invalid('FROZEN_FRESHNESS_CONTRACT_CHANGED');
  if (typeof provenanceVerified !== 'boolean' || typeof comparableToReceiveClock !== 'boolean' || typeof observedBucketPattern !== 'boolean') {
    return invalid('TIMESTAMP_AUTHORITY_EVIDENCE_INVALID');
  }

  let classification = 'UNRESOLVED';
  const reasons = [];

  if (candidateAuthority === 'CLIENT_RECEIVE_TIME') {
    classification = 'CLIENT_RECEIVE_TIME_DIAGNOSTIC_ONLY';
    reasons.push('ARRIVAL_TIME_NOT_EVENT_TIME_AUTHORITY');
  } else if (candidateAuthority === 'PROVIDER_BUCKET_TIME' || observedBucketPattern) {
    classification = 'PROVIDER_BUCKET_TIME_DESCRIPTIVE_ONLY';
    reasons.push('BUCKET_TIME_NOT_PROVEN_EVENT_TIME');
  } else if ((candidateAuthority === 'EXCHANGE_EVENT_TIME' || candidateAuthority === 'PROVIDER_EVENT_TIME') && provenanceVerified && comparableToReceiveClock) {
    classification = candidateAuthority === 'EXCHANGE_EVENT_TIME'
      ? 'EXCHANGE_EVENT_TIME_SUPPORTED'
      : 'PROVIDER_EVENT_TIME_SUPPORTED';
  } else if (candidateAuthority === 'EXCHANGE_EVENT_TIME' || candidateAuthority === 'PROVIDER_EVENT_TIME') {
    reasons.push('EVENT_TIME_PROVENANCE_OR_CLOCK_COMPARABILITY_MISSING');
  } else {
    reasons.push('TIMESTAMP_AUTHORITY_UNRESOLVED');
  }

  const canEvaluateFrozenFreshness = classification === 'EXCHANGE_EVENT_TIME_SUPPORTED' || classification === 'PROVIDER_EVENT_TIME_SUPPORTED';

  return Object.freeze({
    version: TWELVE_TIMESTAMP_AUTHORITY_VERSION,
    classification,
    reasonCodes: Object.freeze(reasons),
    freshnessContractMs: FROZEN_FRESHNESS_CONTRACT_MS,
    canEvaluateFrozenFreshness,
    arrivalTimeCanReplaceEventTime: false,
    bucketTimeCanBypassFreshness: false,
    providerCommissioning: false,
    decisionImpact: 'NONE',
    prospectivePaperAuthorized: false,
    ordersExecuted: 0,
    externalProviderCalls: 0
  });
}
