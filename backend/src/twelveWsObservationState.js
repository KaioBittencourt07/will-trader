export const TWELVE_WS_OBSERVATION_STATE_VERSION = 'twelve-ws-observation-state-v1';

const FROZEN_FRESHNESS_CONTRACT_MS = 30_000;

function safeNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function invariantReport(classification, overrides = {}) {
  return Object.freeze({
    observationStateVersion: TWELVE_WS_OBSERVATION_STATE_VERSION,
    classification,
    transportState: 'UNRESOLVED',
    nativeTimestampState: 'UNRESOLVED',
    freshnessState: 'UNRESOLVED',
    freshnessContractMs: FROZEN_FRESHNESS_CONTRACT_MS,
    freshnessContractChanged: false,
    arrivalTimeRole: 'TRANSPORT_CADENCE_DIAGNOSTIC_ONLY',
    nativeTimestampRole: 'PROVIDER_TEMPORAL_EVIDENCE_ONLY',
    providerCommissioning: false,
    decisionImpact: 'NONE',
    prospectivePaperAuthorized: false,
    ordersExecuted: 0,
    externalProviderCalls: 0,
    ...overrides
  });
}

export function classifyTwelveWsObservationState(observation = {}) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    return invariantReport('DATA_INVALID');
  }

  const diagnostic = observation.arrivalNativeDiagnostic;
  const freshnessEvidence = observation.freshnessEvidence;
  const requiredIntegers = [
    observation.connections,
    observation.subscribeAttempts,
    observation.quoteMessagesObserved,
    observation.freshnessSamplesObserved,
    observation.freshnessPassCount,
    observation.freshnessFailCount,
    diagnostic?.validSamplesObserved,
    diagnostic?.nativeRegressionCount,
    diagnostic?.arrivalRegressionCount,
    diagnostic?.arrivalAdvanceCount
  ];

  if (
    requiredIntegers.some((value) => !safeNonNegativeInteger(value)) ||
    !diagnostic || typeof diagnostic !== 'object' || Array.isArray(diagnostic) ||
    !freshnessEvidence || typeof freshnessEvidence !== 'object' || Array.isArray(freshnessEvidence) ||
    freshnessEvidence.freshnessContractMs !== FROZEN_FRESHNESS_CONTRACT_MS ||
    observation.providerCommissioning !== false ||
    observation.decisionImpact !== 'NONE' ||
    observation.prospectivePaperAuthorized !== false ||
    observation.ordersExecuted !== 0 ||
    diagnostic.providerCommissioning !== false ||
    diagnostic.decisionImpact !== 'NONE' ||
    diagnostic.prospectivePaperAuthorized !== false ||
    diagnostic.ordersExecuted !== 0 ||
    diagnostic.rawTimestampsExposed !== false
  ) {
    return invariantReport('DATA_INVALID');
  }

  const transportActive =
    observation.connections === 1 &&
    observation.subscribeAttempts === 1 &&
    observation.subscribeAccepted === true &&
    observation.quoteMessagesObserved > 0;

  const regressionObserved =
    diagnostic.nativeRegressionCount > 0 ||
    diagnostic.arrivalRegressionCount > 0;

  const nativeBucketed =
    diagnostic.classification === 'NATIVE_BUCKETING_WITH_ARRIVAL_ACTIVITY' &&
    diagnostic.validSamplesObserved > 1 &&
    diagnostic.arrivalAdvanceCount > 0 &&
    diagnostic.minPositiveNativeStepMs === 60_000 &&
    diagnostic.maxPositiveNativeStepMs === 60_000;

  const freshnessFailed =
    observation.classification === 'FRESHNESS_CONTRACT_FAILED' &&
    observation.freshnessFailCount > 0;

  const freshnessPassed =
    observation.classification === 'FRESHNESS_PASS_OBSERVED' &&
    observation.freshnessPassCount > 0 &&
    observation.freshnessFailCount === 0;

  if (regressionObserved) {
    return invariantReport('TEMPORAL_REGRESSION_OBSERVED', {
      transportState: transportActive ? 'ACTIVE' : 'INACTIVE_OR_INCONCLUSIVE',
      nativeTimestampState: 'REGRESSION_OBSERVED',
      freshnessState: freshnessFailed ? 'FAILED' : freshnessPassed ? 'PASS_OBSERVED' : 'UNRESOLVED'
    });
  }

  if (transportActive && nativeBucketed && freshnessFailed) {
    return invariantReport('TRANSPORT_ACTIVE_NATIVE_BUCKETED_FRESHNESS_FAILED', {
      transportState: 'ACTIVE',
      nativeTimestampState: 'MINUTE_BUCKET_PATTERN_SUPPORTED',
      freshnessState: 'FAILED'
    });
  }

  if (transportActive && nativeBucketed && freshnessPassed) {
    return invariantReport('TRANSPORT_ACTIVE_NATIVE_BUCKETED_FRESHNESS_PASS_OBSERVED', {
      transportState: 'ACTIVE',
      nativeTimestampState: 'MINUTE_BUCKET_PATTERN_SUPPORTED',
      freshnessState: 'PASS_OBSERVED'
    });
  }

  if (!transportActive) {
    return invariantReport('TRANSPORT_INACTIVE_OR_INCONCLUSIVE', {
      transportState: 'INACTIVE_OR_INCONCLUSIVE',
      nativeTimestampState: nativeBucketed ? 'MINUTE_BUCKET_PATTERN_SUPPORTED' : 'UNRESOLVED',
      freshnessState: freshnessFailed ? 'FAILED' : freshnessPassed ? 'PASS_OBSERVED' : 'UNRESOLVED'
    });
  }

  return invariantReport('OBSERVATION_STATE_INCONCLUSIVE', {
    transportState: 'ACTIVE',
    nativeTimestampState: nativeBucketed ? 'MINUTE_BUCKET_PATTERN_SUPPORTED' : 'UNRESOLVED',
    freshnessState: freshnessFailed ? 'FAILED' : freshnessPassed ? 'PASS_OBSERVED' : 'UNRESOLVED'
  });
}
