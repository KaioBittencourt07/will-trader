export const TWELVE_WS_EVENT_TIME_SEMANTIC_VERSION = 'twelve-ws-event-time-semantic-v2';

function finite(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function canonical(value) {
  return String(value || '').trim().toUpperCase();
}

function diagnosticsFor(wsHealth, symbol) {
  const target = canonical(symbol);
  const tick = wsHealth?.symbols?.find((entry) => canonical(entry?.symbol) === target) ?? null;
  return tick?.eventTimeDiagnostics ?? null;
}

export function qualifyTwelveWsEventTimeSemantic({
  endpoint = '/v1/quotes/price',
  eventType = 'price',
  timestampField = 'timestamp',
  wsHealth = null,
  symbol = 'EUR/USD',
  minimumAcceptedTicks = 3,
  maximumObservedEventReceiveSkewMs = 5_000
} = {}) {
  const endpointMatches = endpoint === '/v1/quotes/price';
  const eventMatches = eventType === 'price';
  const fieldMatches = timestampField === 'timestamp';
  const fieldProvenanceVerified = endpointMatches && eventMatches && fieldMatches;

  const diagnostics = diagnosticsFor(wsHealth, symbol);
  const acceptedTicks = Number(diagnostics?.acceptedTicks ?? 0);
  const distinctEventTimestamps = Number(diagnostics?.distinctEventTimestamps ?? 0);
  const repeatedTimestampPriceChanges = Number(diagnostics?.repeatedTimestampPriceChanges ?? 0);
  const timestampRegressions = Number(diagnostics?.timestampRegressions ?? 0);
  const minuteAlignedTicks = Number(diagnostics?.minuteAlignedTicks ?? 0);
  const maxAbsEventReceiveSkewMs = finite(diagnostics?.maxAbsEventReceiveSkewMs)
    ? Number(diagnostics.maxAbsEventReceiveSkewMs)
    : null;

  const enoughObservations = acceptedTicks >= Math.max(1, Number(minimumAcceptedTicks || 3));
  const timestampProgresses = distinctEventTimestamps >= 2;
  const repeatedTimestampConflict = repeatedTimestampPriceChanges > 0;
  const monotonic = timestampRegressions === 0;
  const receiveClockCoherent = maxAbsEventReceiveSkewMs !== null
    && maxAbsEventReceiveSkewMs <= Math.max(0, Number(maximumObservedEventReceiveSkewMs || 0));
  const minuteAlignedRatio = acceptedTicks > 0 ? minuteAlignedTicks / acceptedTicks : null;
  const coarseTimestampObserved = repeatedTimestampConflict
    || (enoughObservations && minuteAlignedRatio !== null && minuteAlignedRatio >= 0.8 && !receiveClockCoherent);

  const perEventFreshnessSemanticsVerified = fieldProvenanceVerified
    && enoughObservations
    && timestampProgresses
    && !repeatedTimestampConflict
    && monotonic
    && receiveClockCoherent;

  const semanticClassification = !fieldProvenanceVerified
    ? 'UNRESOLVED'
    : coarseTimestampObserved
      ? 'PROVIDER_COARSE_OR_BUCKETED_UNIX_TIMESTAMP_OBSERVED'
      : perEventFreshnessSemanticsVerified
        ? 'PROVIDER_REALTIME_EVENT_UNIX_TIMESTAMP_EMPIRICALLY_QUALIFIED'
        : 'PROVIDER_UNIX_TIMESTAMP_PER_EVENT_SEMANTICS_UNRESOLVED';

  const reasonCodes = [];
  if (!fieldProvenanceVerified) reasonCodes.push('WEBSOCKET_EVENT_TIME_CONTRACT_MISMATCH');
  if (fieldProvenanceVerified) {
    reasonCodes.push('OFFICIAL_DOCS_PRICE_EVENT_INCLUDES_UNIX_TIMESTAMP');
    reasonCodes.push('ADAPTER_READS_PAYLOAD_TIMESTAMP_FROM_PRICE_EVENT');
  }
  if (!enoughObservations) reasonCodes.push('INSUFFICIENT_WS_EVENT_TIME_OBSERVATIONS');
  if (enoughObservations && !timestampProgresses) reasonCodes.push('WS_EVENT_TIMESTAMP_DID_NOT_PROGRESS');
  if (repeatedTimestampConflict) reasonCodes.push('WS_MULTIPLE_PRICE_CHANGES_SHARE_EVENT_TIMESTAMP');
  if (!monotonic) reasonCodes.push('WS_EVENT_TIMESTAMP_REGRESSION_OBSERVED');
  if (maxAbsEventReceiveSkewMs === null) reasonCodes.push('WS_EVENT_RECEIVE_SKEW_UNAVAILABLE');
  else if (!receiveClockCoherent) reasonCodes.push('WS_EVENT_RECEIVE_SKEW_TOO_LARGE');
  if (coarseTimestampObserved) reasonCodes.push('WS_COARSE_OR_BUCKETED_TIMESTAMP_EVIDENCE');
  if (perEventFreshnessSemanticsVerified) reasonCodes.push('WS_PER_EVENT_TIME_EMPIRICALLY_QUALIFIED');

  return Object.freeze({
    version: TWELVE_WS_EVENT_TIME_SEMANTIC_VERSION,
    source: 'TWELVE_OFFICIAL_WEBSOCKET_DOCUMENTATION_PLUS_RUNTIME_OBSERVATION',
    endpoint,
    eventType,
    timestampField,
    symbol: canonical(symbol) || null,
    semanticClassification,
    semanticReasonCodes: Object.freeze([...new Set(reasonCodes)]),
    fieldProvenanceVerified,
    provenanceVerified: perEventFreshnessSemanticsVerified,
    perEventFreshnessSemanticsVerified,
    comparableToReceiveClock: perEventFreshnessSemanticsVerified,
    canEvaluateFrozenFreshness: perEventFreshnessSemanticsVerified,
    observation: Object.freeze({
      acceptedTicks,
      distinctEventTimestamps,
      repeatedTimestampPriceChanges,
      timestampRegressions,
      minuteAlignedTicks,
      minuteAlignedRatio,
      maxAbsEventReceiveSkewMs,
      maximumAllowedEventReceiveSkewMs: maximumObservedEventReceiveSkewMs,
      enoughObservations,
      timestampProgresses,
      receiveClockCoherent,
      coarseTimestampObserved
    }),
    decisionImpact: perEventFreshnessSemanticsVerified ? 'TEMPORAL_AUTHORITY_ELIGIBLE' : 'NONE'
  });
}
