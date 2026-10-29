import { qualifyTwelveRestTimestampSemantic } from './twelveRestTimestampSemanticQualification.js';
import { classifyTwelveTimestampAuthority } from './twelveTimestampAuthority.js';
import { qualifyPublicExchangeTimestampAuthority } from './publicExchangeTimestampAuthority.js';

export const MARKET_AUTHORITATIVE_FRESHNESS_VERSION = 'market-authoritative-freshness-v2';
export const MARKET_FROZEN_FRESHNESS_CONTRACT_MS = 30_000;

function deriveServerTimestampAuthorityEvidence(snapshot = {}) {
  if (snapshot?.source === 'twelvedata') {
    const fieldName = snapshot?.timestampOrigins?.quoteTimestampField;
    const qualification = qualifyTwelveRestTimestampSemantic(fieldName);
    return Object.freeze({
      source: 'SERVER_TWELVE_REST_SEMANTIC_QUALIFICATION',
      semanticVersion: qualification.version,
      fieldName: qualification.fieldName,
      semanticClassification: qualification.classification,
      semanticReasonCodes: qualification.reasonCodes,
      candidateAuthority: qualification.candidateAuthority,
      provenanceVerified: qualification.provenanceVerified,
      comparableToReceiveClock: qualification.comparableToReceiveClock,
      observedBucketPattern: qualification.observedBucketPattern,
      canEvaluateFrozenFreshness: qualification.canEvaluateFrozenFreshness
    });
  }
  if (snapshot?.source === 'coinbase-exchange-rest' || snapshot?.source === 'binance-spot-rest') {
    return qualifyPublicExchangeTimestampAuthority({
      source: snapshot.source,
      fieldName: snapshot?.timestampOrigins?.quoteTimestampField,
      eventTimestamp: snapshot?.quoteTimestamp ?? snapshot?.timestamp,
      receivedAt: snapshot?.providerReceivedAt,
      quoteAgeMs: snapshot?.quoteAgeMs
    });
  }
  return snapshot?.timestampAuthorityEvidence ?? null;
}

export function buildMarketAuthoritativeFreshness(snapshot = {}) {
  const evidence = deriveServerTimestampAuthorityEvidence(snapshot);
  const candidateAuthority = evidence?.candidateAuthority ?? 'UNRESOLVED';
  const provenanceVerified = evidence?.provenanceVerified === true;
  const comparableToReceiveClock = evidence?.comparableToReceiveClock === true;
  const observedBucketPattern = evidence?.observedBucketPattern === true;

  const authority = evidence?.source === 'SERVER_PUBLIC_EXCHANGE_TIMESTAMP_QUALIFICATION'
    ? {
        classification: evidence.classification,
        reasonCodes: evidence.reasonCodes,
        canEvaluateFrozenFreshness: evidence.canEvaluateFrozenFreshness === true
      }
    : classifyTwelveTimestampAuthority({
        candidateAuthority,
        provenanceVerified,
        comparableToReceiveClock,
        observedBucketPattern,
        freshnessContractMs: MARKET_FROZEN_FRESHNESS_CONTRACT_MS
      });

  const rawAgeMs = snapshot?.ageMs;
  const finiteAge = typeof rawAgeMs === 'number' && Number.isFinite(rawAgeMs) && rawAgeMs >= 0
    ? rawAgeMs
    : null;
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
    timestampAuthorityEvidence: evidence,
    timestampAuthority: authority.classification,
    authorityReasonCodes: authority.reasonCodes,
    authorityGate: authorityPassed ? 'PASS' : 'FAIL',
    freshnessGate,
    freshnessContractMs: MARKET_FROZEN_FRESHNESS_CONTRACT_MS,
    eventAgeMs: finiteAge,
    // Server-derived numeric event timestamp consumed by the canonical study contract.
    eventTimestamp: Number.isFinite(Date.parse(snapshot?.quoteTimestamp ?? snapshot?.timestamp ?? ''))
      ? Date.parse(snapshot?.quoteTimestamp ?? snapshot?.timestamp ?? '')
      : null,
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
