import { observeTwelveWsEventFreshness } from './twelveWsFreshnessObservation.js';

export const TWELVE_R8J_EXECUTION_VERSION = 'twelve-r8j-execution-v1';
export const TWELVE_R8J_AUTHORIZATION = 'R8J_TEMPORAL_SEMANTICS_EXPLICITLY_AUTHORIZED';
export const TWELVE_R8J_LIMITS = Object.freeze({
  symbol: 'EUR/USD',
  connections: 1,
  subscribeAttempts: 1,
  preAcceptTimeoutMs: 5_000,
  observationWindowMs: 60_000,
  heartbeatIntervalMs: 10_000,
  retries: 0,
  reconnects: 0,
  redirects: 0,
  restRequests: 0,
  saxoRequests: 0,
  avalonRequests: 0,
  freshnessContractMs: 30_000
});

const OBSERVATION_KEYS = new Set([
  'observationVersion', 'connections', 'subscribeAttempts', 'subscribeAccepted', 'quoteMessagesObserved',
  'observationWindowMs', 'preAcceptTimeoutMs', 'heartbeatIntervalMs', 'heartbeatsSent', 'closeCode', 'retries',
  'reconnects', 'redirects', 'applicationMessagesSent', 'freshnessSamplesObserved', 'freshnessPassCount',
  'freshnessFailCount', 'freshnessInvalidCount', 'freshnessUnverifiedCount', 'minEventAgeMs', 'maxEventAgeMs',
  'lastEventAgeMs', 'classification', 'freshnessEvidence', 'timestampProgressionVersion', 'timestampSamplesObserved',
  'validTimestampSamplesObserved', 'invalidTimestampCount', 'distinctNativeEventTimestampCount',
  'repeatedTimestampQuoteCount', 'timestampAdvanceCount', 'timestampRegressionCount', 'minPositiveTimestampStepMs',
  'maxPositiveTimestampStepMs', 'maxQuotesSharingNativeTimestamp', 'nativeTimestampProgressed',
  'timestampProgressionClassification', 'arrivalNativeDiagnostic', 'providerCommissioning', 'decisionImpact',
  'prospectivePaperAuthorized', 'ordersExecuted', 'externalProviderCalls', 'restRequests', 'saxoRequests', 'secretExposed'
]);

const FRESHNESS_KEYS = new Set([
  'freshnessVersion', 'eventTimestampObserved', 'receiveTimestampObserved', 'eventAgeMs', 'freshnessContractMs',
  'freshnessGate', 'blocker', 'clockComparabilityGate', 'timestampUnitGate', 'futureTimestampGate',
  'providerCommissioning', 'decisionImpact', 'prospectivePaperAuthorized', 'ordersExecuted', 'externalProviderCalls'
]);

const TEMPORAL_KEYS = new Set([
  'diagnosticVersion', 'samplesObserved', 'validSamplesObserved', 'invalidSampleCount', 'distinctNativeTimestampCount',
  'repeatedNativeTimestampQuoteCount', 'maxQuotesPerNativeTimestamp', 'nativeAdvanceCount', 'nativeRegressionCount',
  'arrivalAdvanceCount', 'arrivalRegressionCount', 'minPositiveNativeStepMs', 'maxPositiveNativeStepMs',
  'minPositiveArrivalStepMs', 'maxPositiveArrivalStepMs', 'classification', 'freshnessInterpretation',
  'providerCommissioning', 'decisionImpact', 'prospectivePaperAuthorized', 'ordersExecuted', 'externalProviderCalls',
  'rawTimestampsExposed'
]);

function blocked(reasonCodes) {
  return Object.freeze({
    executionVersion: TWELVE_R8J_EXECUTION_VERSION,
    result: 'BLOCKED',
    reasonCodes: Object.freeze(reasonCodes),
    providerCommissioning: false,
    decisionImpact: 'NONE',
    prospectivePaperAuthorized: false,
    ordersExecuted: 0,
    externalProviderCalls: 0,
    secretExposed: false
  });
}

function strictObject(value, allowedKeys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every((key) => allowedKeys.has(key));
}

export async function runTwelveR8jExecution({ env = process.env, observer = observeTwelveWsEventFreshness } = {}) {
  const reasons = [];
  if (env.WILL_TWELVE_R8J_ENABLED !== 'true') reasons.push('R8J_DISABLED');
  if (env.WILL_TWELVE_R8J_AUTHORIZATION !== TWELVE_R8J_AUTHORIZATION) reasons.push('R8J_AUTHORIZATION_INVALID');
  if (!env.TWELVEDATA_API_KEY) reasons.push('TWELVE_KEY_MISSING');
  if (reasons.length) return blocked(reasons);

  const observation = await observer({
    apiKey: env.TWELVEDATA_API_KEY,
    authorization: TWELVE_R8J_AUTHORIZATION,
    includeArrivalNativeDiagnostic: true,
    preAcceptTimeoutMs: TWELVE_R8J_LIMITS.preAcceptTimeoutMs,
    observationWindowMs: TWELVE_R8J_LIMITS.observationWindowMs,
    heartbeatIntervalMs: TWELVE_R8J_LIMITS.heartbeatIntervalMs
  });

  const freshness = observation?.freshnessEvidence;
  const temporal = observation?.arrivalNativeDiagnostic;
  const invalid = !strictObject(observation, OBSERVATION_KEYS) ||
    !strictObject(freshness, FRESHNESS_KEYS) || !strictObject(temporal, TEMPORAL_KEYS) ||
    observation.providerCommissioning !== false || observation.decisionImpact !== 'NONE' ||
    observation.prospectivePaperAuthorized !== false || observation.ordersExecuted !== 0 ||
    observation.retries !== 0 || observation.reconnects !== 0 || observation.redirects !== 0 ||
    observation.restRequests !== 0 || observation.saxoRequests !== 0 || observation.secretExposed !== false ||
    ![0, 1].includes(observation.connections) || ![0, 1].includes(observation.subscribeAttempts) ||
    ![0, 1].includes(observation.externalProviderCalls) ||
    observation.preAcceptTimeoutMs !== TWELVE_R8J_LIMITS.preAcceptTimeoutMs ||
    observation.observationWindowMs !== TWELVE_R8J_LIMITS.observationWindowMs ||
    observation.heartbeatIntervalMs < TWELVE_R8J_LIMITS.heartbeatIntervalMs ||
    freshness.freshnessContractMs !== TWELVE_R8J_LIMITS.freshnessContractMs ||
    temporal.providerCommissioning !== false || temporal.decisionImpact !== 'NONE' ||
    temporal.prospectivePaperAuthorized !== false || temporal.ordersExecuted !== 0 ||
    temporal.externalProviderCalls !== 0 || temporal.rawTimestampsExposed !== false ||
    temporal.freshnessInterpretation !== 'NOT_EVALUATED';

  if (invalid) return blocked(['UNSANITIZED_OR_OUT_OF_BOUNDS_OBSERVATION']);

  return Object.freeze({
    executionVersion: TWELVE_R8J_EXECUTION_VERSION,
    result: 'OBSERVED',
    ...observation,
    providerCommissioning: false,
    decisionImpact: 'NONE',
    prospectivePaperAuthorized: false,
    ordersExecuted: 0,
    secretExposed: false
  });
}
