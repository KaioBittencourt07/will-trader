import { diagnoseTwelveWsArrivalNative } from './twelveWsArrivalNativeDiagnostic.js';

export const TWELVE_WS_TEMPORAL_SEMANTICS_VERSION = 'twelve-ws-temporal-semantics-v1';

export function diagnoseTwelveWsTemporalSemantics(samples = [], options = {}) {
  const base = diagnoseTwelveWsArrivalNative(samples, options);

  let temporalSemanticsClassification = 'INSUFFICIENT_EVIDENCE';
  let nativeTimestampSemantics = 'UNRESOLVED';

  if (base.classification === 'DATA_INVALID') {
    temporalSemanticsClassification = 'DATA_INVALID';
  } else if (base.nativeRegressionCount > 0 || base.arrivalRegressionCount > 0) {
    temporalSemanticsClassification = 'TEMPORAL_REGRESSION_OBSERVED';
  } else {
    const minuteStepObserved =
      base.nativeAdvanceCount > 0 &&
      base.minPositiveNativeStepMs === 60_000 &&
      base.maxPositiveNativeStepMs === 60_000;

    const repeatedWithinNativeTimestamp =
      base.repeatedNativeTimestampQuoteCount > 0 &&
      base.maxQuotesPerNativeTimestamp > 1;

    const arrivalActivityObserved =
      base.arrivalAdvanceCount > 0 &&
      base.minPositiveArrivalStepMs !== null;

    if (minuteStepObserved && repeatedWithinNativeTimestamp && arrivalActivityObserved) {
      temporalSemanticsClassification = 'MINUTE_BUCKET_PATTERN_SUPPORTED';
      nativeTimestampSemantics = 'LIKELY_MINUTE_BUCKET_MARKER_DESCRIPTIVE_ONLY';
    } else if (base.nativeAdvanceCount > 0 && arrivalActivityObserved) {
      temporalSemanticsClassification = 'NATIVE_EVENT_TIME_PROGRESSION_SUPPORTED';
      nativeTimestampSemantics = 'EVENT_TIME_PROGRESSIVE_DESCRIPTIVE_ONLY';
    } else if (base.validSamplesObserved > 0) {
      temporalSemanticsClassification = 'INSUFFICIENT_PROGRESSIVE_EVIDENCE';
    }
  }

  return Object.freeze({
    temporalSemanticsVersion: TWELVE_WS_TEMPORAL_SEMANTICS_VERSION,
    sourceDiagnosticVersion: base.diagnosticVersion,
    samplesObserved: base.samplesObserved,
    validSamplesObserved: base.validSamplesObserved,
    invalidSampleCount: base.invalidSampleCount,
    distinctNativeTimestampCount: base.distinctNativeTimestampCount,
    repeatedNativeTimestampQuoteCount: base.repeatedNativeTimestampQuoteCount,
    maxQuotesPerNativeTimestamp: base.maxQuotesPerNativeTimestamp,
    nativeAdvanceCount: base.nativeAdvanceCount,
    nativeRegressionCount: base.nativeRegressionCount,
    arrivalAdvanceCount: base.arrivalAdvanceCount,
    arrivalRegressionCount: base.arrivalRegressionCount,
    minPositiveNativeStepMs: base.minPositiveNativeStepMs,
    maxPositiveNativeStepMs: base.maxPositiveNativeStepMs,
    minPositiveArrivalStepMs: base.minPositiveArrivalStepMs,
    maxPositiveArrivalStepMs: base.maxPositiveArrivalStepMs,
    temporalSemanticsClassification,
    nativeTimestampSemantics,
    freshnessContractMs: 30_000,
    freshnessContractChanged: false,
    freshnessAuthority: 'UNCHANGED_NATIVE_EVENT_TIME_CONTRACT',
    arrivalTimeRole: 'TRANSPORT_CADENCE_DIAGNOSTIC_ONLY',
    providerCommissioning: false,
    decisionImpact: 'NONE',
    prospectivePaperAuthorized: false,
    ordersExecuted: 0,
    externalProviderCalls: 0,
    rawTimestampsExposed: false
  });
}
