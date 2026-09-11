export const TWELVE_R8K_EXECUTION_VERSION = 'twelve-r8k-execution-v1';
export const TWELVE_R8K_AUTHORIZATION = 'R8K_TIMESTAMP_SEMANTICS_EXPLICITLY_AUTHORIZED';
export const TWELVE_R8K_LIMITS = Object.freeze({
  symbol: 'EUR/USD', connections: 1, subscribeAttempts: 1,
  preAcceptTimeoutMs: 5_000, observationWindowMs: 60_000,
  heartbeatIntervalMs: 10_000, retries: 0, reconnects: 0,
  redirects: 0, restRequests: 0, avalonRequests: 0,
  freshnessContractMs: 30_000
});

const ALLOWED_METADATA_FIELDS = new Set([
  'eventFieldPresent','symbolFieldPresent','timestampFieldPresent','timestampFinite',
  'timestampUnitObserved','timestampDistinctCount','timestampAdvanceCount',
  'timestampRegressionCount','repeatedTimestampCount','minPositiveTimestampStepMs',
  'maxPositiveTimestampStepMs','arrivalAdvanceCount','arrivalRegressionCount',
  'rawPayloadRetained','rawPriceRetained','rawTimestampRetained'
]);

function blocked(reasonCodes) {
  return Object.freeze({ executionVersion: TWELVE_R8K_EXECUTION_VERSION, result: 'BLOCKED',
    reasonCodes: Object.freeze(reasonCodes), freshnessContractMs: 30_000,
    timestampSemantics: 'UNVERIFIED', providerCommissioning: false, decisionImpact: 'NONE',
    prospectivePaperAuthorized: false, ordersExecuted: 0, externalProviderCalls: 0,
    secretExposed: false });
}

function safeMetadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every((key) => ALLOWED_METADATA_FIELDS.has(key)) &&
    value.rawPayloadRetained === false && value.rawPriceRetained === false &&
    value.rawTimestampRetained === false;
}

export async function runTwelveR8kExecution({ env = process.env, observer } = {}) {
  const reasons = [];
  if (env.WILL_TWELVE_R8K_ENABLED !== 'true') reasons.push('R8K_DISABLED');
  if (env.WILL_TWELVE_R8K_AUTHORIZATION !== TWELVE_R8K_AUTHORIZATION) reasons.push('R8K_AUTHORIZATION_INVALID');
  if (!env.TWELVEDATA_API_KEY) reasons.push('TWELVE_KEY_MISSING');
  if (typeof observer !== 'function') reasons.push('R8K_OBSERVER_NOT_CONFIGURED');
  if (reasons.length) return blocked(reasons);

  const result = await observer({
    apiKey: env.TWELVEDATA_API_KEY,
    authorization: TWELVE_R8K_AUTHORIZATION,
    symbol: TWELVE_R8K_LIMITS.symbol,
    observationWindowMs: TWELVE_R8K_LIMITS.observationWindowMs,
    preAcceptTimeoutMs: TWELVE_R8K_LIMITS.preAcceptTimeoutMs,
    heartbeatIntervalMs: TWELVE_R8K_LIMITS.heartbeatIntervalMs,
    metadataOnly: true
  });

  const invalid = !result || typeof result !== 'object' || Array.isArray(result) ||
    !safeMetadata(result.metadata) || result.connections !== 1 ||
    result.subscribeAttempts !== 1 || result.retries !== 0 || result.reconnects !== 0 ||
    result.redirects !== 0 || result.restRequests !== 0 || result.externalProviderCalls !== 1 ||
    result.observationWindowMs !== 60_000 || result.preAcceptTimeoutMs !== 5_000 ||
    result.heartbeatIntervalMs < 10_000 || result.providerCommissioning !== false ||
    result.decisionImpact !== 'NONE' || result.prospectivePaperAuthorized !== false ||
    result.ordersExecuted !== 0 || result.secretExposed !== false;

  if (invalid) return blocked(['UNSANITIZED_OR_OUT_OF_BOUNDS_OBSERVATION']);

  return Object.freeze({
    executionVersion: TWELVE_R8K_EXECUTION_VERSION,
    result: 'OBSERVED', metadata: Object.freeze({ ...result.metadata }),
    freshnessContractMs: 30_000, freshnessContractChanged: false,
    timestampSemantics: 'UNVERIFIED_PENDING_EVIDENCE_REVIEW',
    providerCommissioning: false, decisionImpact: 'NONE', prospectivePaperAuthorized: false,
    ordersExecuted: 0, externalProviderCalls: 1, secretExposed: false
  });
}
