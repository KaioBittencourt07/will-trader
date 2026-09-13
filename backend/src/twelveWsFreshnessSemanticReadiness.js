export const TWELVE_WS_FRESHNESS_SEMANTIC_READINESS_VERSION = 'twelve-ws-freshness-semantic-readiness-v1';
export const TWELVE_WS_FROZEN_FRESHNESS_CONTRACT_MS = 30_000;

export function evaluateTwelveWsFreshnessSemanticReadiness(evidence = {}) {
  const safe = evidence && typeof evidence === 'object' && !Array.isArray(evidence) ? evidence : {};
  const allowed = new Set(['providerDocumentsTimestampAsUnix', 'providerDocumentsPriceEventsAsRealtimeTicks',
    'providerDocumentsTimestampAsPerTickEventTime', 'observedMinuteBucketPattern', 'frozenFreshnessContractMs']);
  const unknown = Object.keys(safe).filter((key) => !allowed.has(key));
  const frozen = safe.frozenFreshnessContractMs ?? TWELVE_WS_FROZEN_FRESHNESS_CONTRACT_MS;

  let classification = 'FRESHNESS_SEMANTICS_UNVERIFIED';
  let blocker = 'PER_TICK_EVENT_TIME_SEMANTICS_NOT_PROVEN';
  if (unknown.length || frozen !== TWELVE_WS_FROZEN_FRESHNESS_CONTRACT_MS) {
    classification = 'DATA_INVALID';
    blocker = unknown.length ? 'UNSANITIZED_OR_UNKNOWN_EVIDENCE' : 'FROZEN_FRESHNESS_CONTRACT_CHANGED';
  } else if (safe.providerDocumentsTimestampAsPerTickEventTime === true && safe.providerDocumentsTimestampAsUnix === true) {
    classification = 'PER_TICK_EVENT_TIME_SEMANTICS_SUPPORTED';
    blocker = null;
  }

  return Object.freeze({
    readinessVersion: TWELVE_WS_FRESHNESS_SEMANTIC_READINESS_VERSION,
    classification,
    blocker,
    providerDocumentsTimestampAsUnix: safe.providerDocumentsTimestampAsUnix === true,
    providerDocumentsPriceEventsAsRealtimeTicks: safe.providerDocumentsPriceEventsAsRealtimeTicks === true,
    providerDocumentsTimestampAsPerTickEventTime: safe.providerDocumentsTimestampAsPerTickEventTime === true,
    observedMinuteBucketPattern: safe.observedMinuteBucketPattern === true,
    freshnessContractMs: TWELVE_WS_FROZEN_FRESHNESS_CONTRACT_MS,
    freshnessContractChanged: false,
    arrivalTimeCanReplaceEventTime: false,
    bucketSemanticsCanBypassFreshness: false,
    providerCommissioning: false,
    decisionImpact: 'NONE',
    prospectivePaperAuthorized: false,
    ordersExecuted: 0,
    externalProviderCalls: 0
  });
}
