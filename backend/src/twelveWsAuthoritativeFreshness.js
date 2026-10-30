import { evaluateTwelveWsEventFreshness, TWELVE_WS_FRESHNESS_CONTRACT_MS } from './twelveWsEventFreshness.js';
import { classifyTwelveTimestampAuthority } from './twelveTimestampAuthority.js';

export const TWELVE_WS_AUTHORITATIVE_FRESHNESS_VERSION = 'twelve-ws-authoritative-freshness-v1';

export function evaluateTwelveWsAuthoritativeFreshness({
  eventTimestamp,
  eventTimestampUnit,
  receiveTimestamp,
  receiveTimestampUnit,
  candidateAuthority = 'UNRESOLVED',
  provenanceVerified = false,
  comparableToReceiveClock = false,
  observedBucketPattern = false
} = {}) {
  const authority = classifyTwelveTimestampAuthority({
    candidateAuthority,
    provenanceVerified,
    comparableToReceiveClock,
    observedBucketPattern,
    freshnessContractMs: TWELVE_WS_FRESHNESS_CONTRACT_MS
  });

  const base = {
    version: TWELVE_WS_AUTHORITATIVE_FRESHNESS_VERSION,
    timestampAuthority: authority.classification,
    authorityReasonCodes: authority.reasonCodes,
    authorityGate: authority.canEvaluateFrozenFreshness ? 'PASS' : 'FAIL',
    freshnessContractMs: TWELVE_WS_FRESHNESS_CONTRACT_MS,
    freshnessGate: 'UNVERIFIED',
    eventAgeMs: null,
    blocker: null,
    arrivalTimeCanReplaceEventTime: false,
    bucketTimeCanBypassFreshness: false,
    providerCommissioning: false,
    decisionImpact: 'NONE',
    prospectivePaperAuthorized: false,
    ordersExecuted: 0,
    externalProviderCalls: 0
  };

  if (!authority.canEvaluateFrozenFreshness) {
    return Object.freeze({
      ...base,
      blocker: authority.classification === 'DATA_INVALID'
        ? 'TIMESTAMP_AUTHORITY_DATA_INVALID'
        : 'TIMESTAMP_AUTHORITY_UNVERIFIED'
    });
  }

  const freshness = evaluateTwelveWsEventFreshness({
    eventTimestamp,
    eventTimestampUnit,
    receiveTimestamp,
    receiveTimestampUnit
  });

  return Object.freeze({
    ...base,
    freshnessGate: freshness.freshnessGate,
    eventAgeMs: freshness.eventAgeMs,
    blocker: freshness.blocker,
    timestampUnitGate: freshness.timestampUnitGate,
    clockComparabilityGate: freshness.clockComparabilityGate,
    futureTimestampGate: freshness.futureTimestampGate
  });
}
