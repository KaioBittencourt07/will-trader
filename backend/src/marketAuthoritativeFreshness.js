import { classifyTwelveTimestampAuthority } from './twelveTimestampAuthority.js';

export const MARKET_AUTHORITATIVE_FRESHNESS_VERSION = 'market-authoritative-freshness-v1';
export const MARKET_FROZEN_FRESHNESS_CONTRACT_MS = 30_000;

export function buildMarketAuthoritativeFreshness(snapshot = {}) {
  const evidence = snapshot?.timestampAuthorityEvidence;
  const candidateAuthority = evidence?.candidateAuthority ?? 'UNRESOLVED';
  const provenanceVerified = evidence?.provenanceVerified === true;
  const comparableToReceiveClock = evidence?.comparableToReceiveClock === true;
  const observedBucketPattern = evidence?.observedBucketPattern === true;

  const authority = classifyTwelveTimestampAuthority({
    candidateAuthority,
    provenanceVerified,
    comparableToReceiveClock,
    observedBucketPattern,
    freshnessContractMs: MARKET_FROZEN_FRESHNESS_CONTRACT_MS
  });

  const ageMs = Number(snapshot?.ageMs);
  const finiteAge = Number.isFinite(ageMs) && ageMs >= 0 ? ageMs : null;
  const authorityPassed = authority.canEvaluateFrozenFreshness === true;
  const freshnessGate = authorityPassed && finiteAge !== null
    ? (finiteAge <= MARKET_FROZEN_FRESHNESS_CONTRACT_MS ? 'PASS' : 'FAIL')
    : 'UNVERIFIED';

  let blocker = null;
  if (!authorityPassed) blocker = authority.classification === 'DATA_INVALID'
    ? 'TIMESTAMP_AUTHORITY_DATA_INVALID'
    : 'TIMESTAMP_AUTHORITY_UNVERIFIED';
  else if (finiteAge === null) blocker = 'MARKET_AGE_UNAVAILABLE';
  else if (freshnessGate === 'FAIL') blocker = 'EVENT_OLDER_THAN_FROZEN_CONTRACT';

  return Object.freeze({
    version: MARKET_AUTHORITATIVE_FRESHNESS_VERSION,
    serverDerived: true,
    source: snapshot?.source ?? null,
    freshnessBasis: snapshot?.freshnessBasis ?? null,
    timestampAuthority: authority.classification,
    authorityReasonCodes: authority.reasonCodes,
    authorityGate: authorityPassed ? 'PASS' : 'FAIL',
    freshnessGate,
    freshnessContractMs: MARKET_FROZEN_FRESHNESS_CONTRACT_MS,
    eventAgeMs: finiteAge,
    blocker,
    arrivalTimeCanReplaceEventTime: false,
    bucketTimeCanBypassFreshness: false,
    providerCommissioning: false,
    decisionImpact: 'NONE',
    prospectivePaperAuthorized: false,
    ordersExecuted: 0,
    externalProviderCalls: 0
  });
}

export function attachMarketAuthoritativeFreshness(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return snapshot;
  return Object.freeze({
    ...snapshot,
    authoritativeFreshness: buildMarketAuthoritativeFreshness(snapshot)
  });
}
