import { observeTwelveWsEventFreshness } from './twelveWsFreshnessObservation.js';

export const TWELVE_R8I_EXECUTION_VERSION = 'twelve-r8i-execution-v1';
export const TWELVE_R8I_AUTHORIZATION = 'R8I_TIMESTAMP_PROGRESSION_EXPLICITLY_AUTHORIZED';
export const TWELVE_R8I_LIMITS = Object.freeze({ symbol: 'EUR/USD', connections: 1, subscribeAttempts: 1,
  preAcceptTimeoutMs: 5_000, observationWindowMs: 60_000, heartbeatIntervalMs: 10_000,
  retries: 0, reconnects: 0, redirects: 0, restRequests: 0, saxoRequests: 0, avalonRequests: 0 });
const OBSERVATION_KEYS = new Set(['observationVersion', 'connections', 'subscribeAttempts', 'subscribeAccepted', 'quoteMessagesObserved',
  'observationWindowMs', 'preAcceptTimeoutMs', 'heartbeatIntervalMs', 'heartbeatsSent', 'closeCode', 'retries', 'reconnects', 'redirects',
  'applicationMessagesSent', 'freshnessSamplesObserved', 'freshnessPassCount', 'freshnessFailCount', 'freshnessInvalidCount',
  'freshnessUnverifiedCount', 'minEventAgeMs', 'maxEventAgeMs', 'lastEventAgeMs', 'classification', 'freshnessEvidence',
  'timestampProgressionVersion', 'timestampSamplesObserved', 'validTimestampSamplesObserved', 'invalidTimestampCount',
  'distinctNativeEventTimestampCount', 'repeatedTimestampQuoteCount', 'timestampAdvanceCount', 'timestampRegressionCount',
  'minPositiveTimestampStepMs', 'maxPositiveTimestampStepMs', 'maxQuotesSharingNativeTimestamp', 'nativeTimestampProgressed',
  'timestampProgressionClassification', 'providerCommissioning', 'decisionImpact', 'prospectivePaperAuthorized', 'ordersExecuted',
  'externalProviderCalls', 'restRequests', 'saxoRequests', 'secretExposed']);
const FRESHNESS_KEYS = new Set(['freshnessVersion', 'eventTimestampObserved', 'receiveTimestampObserved', 'eventAgeMs',
  'freshnessContractMs', 'freshnessGate', 'blocker', 'clockComparabilityGate', 'timestampUnitGate', 'futureTimestampGate',
  'providerCommissioning', 'decisionImpact', 'prospectivePaperAuthorized', 'ordersExecuted', 'externalProviderCalls']);

function blocked(reasonCodes) {
  return Object.freeze({ executionVersion: TWELVE_R8I_EXECUTION_VERSION, result: 'BLOCKED', reasonCodes: Object.freeze(reasonCodes),
    providerCommissioning: false, decisionImpact: 'NONE', prospectivePaperAuthorized: false, ordersExecuted: 0,
    externalProviderCalls: 0, secretExposed: false });
}

export async function runTwelveR8iExecution({ env = process.env, observer = observeTwelveWsEventFreshness } = {}) {
  const reasons = [];
  if (env.WILL_TWELVE_R8I_ENABLED !== 'true') reasons.push('R8I_DISABLED');
  if (env.WILL_TWELVE_R8I_AUTHORIZATION !== TWELVE_R8I_AUTHORIZATION) reasons.push('R8I_AUTHORIZATION_INVALID');
  if (!env.TWELVEDATA_API_KEY) reasons.push('TWELVE_KEY_MISSING');
  if (reasons.length) return blocked(reasons);
  const observation = await observer({ apiKey: env.TWELVEDATA_API_KEY, authorization: TWELVE_R8I_AUTHORIZATION,
    preAcceptTimeoutMs: TWELVE_R8I_LIMITS.preAcceptTimeoutMs, observationWindowMs: TWELVE_R8I_LIMITS.observationWindowMs,
    heartbeatIntervalMs: TWELVE_R8I_LIMITS.heartbeatIntervalMs });
  const nestedFreshnessInvalid = !observation?.freshnessEvidence || typeof observation.freshnessEvidence !== 'object' ||
    Array.isArray(observation.freshnessEvidence) || Object.keys(observation.freshnessEvidence).some((key) => !FRESHNESS_KEYS.has(key));
  if (!observation || typeof observation !== 'object' || Array.isArray(observation) || nestedFreshnessInvalid ||
      Object.keys(observation).some((key) => !OBSERVATION_KEYS.has(key)) || observation.providerCommissioning !== false ||
      observation.decisionImpact !== 'NONE' || observation.prospectivePaperAuthorized !== false || observation.ordersExecuted !== 0 ||
      observation.retries !== 0 || observation.reconnects !== 0 || observation.redirects !== 0 || observation.restRequests !== 0 ||
      observation.saxoRequests !== 0 || observation.secretExposed !== false || ![0, 1].includes(observation.connections) ||
      ![0, 1].includes(observation.subscribeAttempts) || ![0, 1].includes(observation.externalProviderCalls) ||
      observation.preAcceptTimeoutMs !== TWELVE_R8I_LIMITS.preAcceptTimeoutMs || observation.observationWindowMs !== TWELVE_R8I_LIMITS.observationWindowMs ||
      observation.heartbeatIntervalMs < TWELVE_R8I_LIMITS.heartbeatIntervalMs) return blocked(['UNSANITIZED_OR_OUT_OF_BOUNDS_OBSERVATION']);
  return Object.freeze({ executionVersion: TWELVE_R8I_EXECUTION_VERSION, result: 'OBSERVED', ...observation,
    providerCommissioning: false, decisionImpact: 'NONE', prospectivePaperAuthorized: false, ordersExecuted: 0,
    secretExposed: false });
}
