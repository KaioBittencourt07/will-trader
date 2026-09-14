export const TWELVE_WS_EVENT_TIME_SEMANTIC_VERSION = 'twelve-ws-event-time-semantic-v1';

export function qualifyTwelveWsEventTimeSemantic({
  endpoint = '/v1/quotes/price',
  eventType = 'price',
  timestampField = 'timestamp'
} = {}) {
  const endpointMatches = endpoint === '/v1/quotes/price';
  const eventMatches = eventType === 'price';
  const fieldMatches = timestampField === 'timestamp';
  const provenanceVerified = endpointMatches && eventMatches && fieldMatches;

  return Object.freeze({
    version: TWELVE_WS_EVENT_TIME_SEMANTIC_VERSION,
    source: 'TWELVE_OFFICIAL_WEBSOCKET_DOCUMENTATION',
    endpoint,
    eventType,
    timestampField,
    semanticClassification: provenanceVerified
      ? 'PROVIDER_REALTIME_TICK_UNIX_TIMESTAMP'
      : 'UNRESOLVED',
    semanticReasonCodes: Object.freeze(provenanceVerified
      ? [
          'OFFICIAL_DOCS_PRICE_EVENT_IS_REALTIME_TICK',
          'OFFICIAL_DOCS_PRICE_EVENT_INCLUDES_UNIX_TIMESTAMP',
          'ADAPTER_READS_PAYLOAD_TIMESTAMP_FROM_PRICE_EVENT'
        ]
      : ['WEBSOCKET_EVENT_TIME_CONTRACT_MISMATCH']),
    provenanceVerified,
    comparableToReceiveClock: provenanceVerified,
    canEvaluateFrozenFreshness: provenanceVerified,
    decisionImpact: provenanceVerified ? 'TEMPORAL_AUTHORITY_ELIGIBLE' : 'NONE'
  });
}
