export const TWELVE_REST_TIMESTAMP_SEMANTIC_VERSION = 'twelve-rest-timestamp-semantic-v1';

const SOURCE_EVIDENCE = Object.freeze({
  timestamp: Object.freeze({
    classification: 'PROVIDER_BUCKET_TIME',
    candidateAuthority: 'PROVIDER_BUCKET_TIME',
    provenanceVerified: true,
    comparableToReceiveClock: false,
    observedBucketPattern: true,
    canEvaluateFrozenFreshness: false,
    reasonCodes: Object.freeze([
      'OFFICIAL_QUOTE_TIMESTAMP_IS_INTERVAL_OPEN_TIME',
      'BUCKET_TIME_NOT_PER_EVENT_TIME'
    ])
  }),
  last_update_at: Object.freeze({
    classification: 'RECENT_QUOTE_TIME_SEMANTICS_UNRESOLVED',
    candidateAuthority: 'UNRESOLVED',
    provenanceVerified: false,
    comparableToReceiveClock: false,
    observedBucketPattern: false,
    canEvaluateFrozenFreshness: false,
    reasonCodes: Object.freeze([
      'OFFICIAL_RECENT_QUOTE_TIME_WORDING_FOUND',
      'PER_EVENT_TIME_PROVENANCE_NOT_PROVEN',
      'CLOCK_COMPARABILITY_NOT_PROVEN'
    ])
  }),
  last_quote_at: Object.freeze({
    classification: 'LAST_QUOTE_AT_SEMANTICS_UNRESOLVED',
    candidateAuthority: 'UNRESOLVED',
    provenanceVerified: false,
    comparableToReceiveClock: false,
    observedBucketPattern: false,
    canEvaluateFrozenFreshness: false,
    reasonCodes: Object.freeze([
      'FIELD_USED_BY_PROVIDER_ADAPTER',
      'OFFICIAL_PER_EVENT_TIME_SEMANTICS_NOT_PROVEN',
      'CLOCK_COMPARABILITY_NOT_PROVEN'
    ])
  })
});

export function qualifyTwelveRestTimestampSemantic(fieldName) {
  const normalized = String(fieldName ?? '').trim();
  const evidence = SOURCE_EVIDENCE[normalized];

  if (!evidence) {
    return Object.freeze({
      version: TWELVE_REST_TIMESTAMP_SEMANTIC_VERSION,
      fieldName: normalized || null,
      classification: 'DATA_INVALID',
      candidateAuthority: 'UNRESOLVED',
      provenanceVerified: false,
      comparableToReceiveClock: false,
      observedBucketPattern: false,
      canEvaluateFrozenFreshness: false,
      reasonCodes: Object.freeze(['TIMESTAMP_FIELD_UNKNOWN']),
      freshnessContractMs: 30_000,
      freshnessContractChanged: false,
      providerCommissioning: false,
      decisionImpact: 'NONE',
      prospectivePaperAuthorized: false,
      ordersExecuted: 0,
      externalProviderCalls: 0
    });
  }

  return Object.freeze({
    version: TWELVE_REST_TIMESTAMP_SEMANTIC_VERSION,
    fieldName: normalized,
    ...evidence,
    freshnessContractMs: 30_000,
    freshnessContractChanged: false,
    providerCommissioning: false,
    decisionImpact: 'NONE',
    prospectivePaperAuthorized: false,
    ordersExecuted: 0,
    externalProviderCalls: 0
  });
}
