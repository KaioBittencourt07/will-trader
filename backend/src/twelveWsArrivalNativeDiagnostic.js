export const TWELVE_WS_ARRIVAL_NATIVE_DIAGNOSTIC_VERSION = 'twelve-ws-arrival-native-diagnostic-v1';

const UNIT_MULTIPLIER_MS = Object.freeze({
  UNIX_SECONDS: 1_000,
  UNIX_MILLISECONDS: 1
});

function normalize(value, unit) {
  const multiplier = UNIT_MULTIPLIER_MS[unit];
  if (!multiplier || !Number.isFinite(value)) return null;
  const milliseconds = value * multiplier;
  return Number.isSafeInteger(milliseconds) ? milliseconds : null;
}

export function diagnoseTwelveWsArrivalNative(samples = [], {
  nativeTimestampUnit = 'UNIX_SECONDS',
  receiveTimestampUnit = 'UNIX_MILLISECONDS'
} = {}) {
  const input = Array.isArray(samples) ? samples : [];
  const normalized = [];
  let invalidSampleCount = Array.isArray(samples) ? 0 : 1;

  for (const sample of input) {
    const nativeMs = normalize(sample?.nativeTimestamp, nativeTimestampUnit);
    const receiveMs = normalize(sample?.receiveTimestamp, receiveTimestampUnit);
    if (nativeMs === null || receiveMs === null) {
      invalidSampleCount += 1;
      continue;
    }
    normalized.push({ nativeMs, receiveMs });
  }

  let nativeAdvanceCount = 0;
  let nativeRegressionCount = 0;
  let arrivalAdvanceCount = 0;
  let arrivalRegressionCount = 0;
  const nativePositiveSteps = [];
  const arrivalPositiveSteps = [];

  for (let index = 1; index < normalized.length; index += 1) {
    const nativeStep = normalized[index].nativeMs - normalized[index - 1].nativeMs;
    const arrivalStep = normalized[index].receiveMs - normalized[index - 1].receiveMs;

    if (nativeStep > 0) {
      nativeAdvanceCount += 1;
      nativePositiveSteps.push(nativeStep);
    } else if (nativeStep < 0) {
      nativeRegressionCount += 1;
    }

    if (arrivalStep > 0) {
      arrivalAdvanceCount += 1;
      arrivalPositiveSteps.push(arrivalStep);
    } else if (arrivalStep < 0) {
      arrivalRegressionCount += 1;
    }
  }

  const nativeFrequency = new Map();
  for (const sample of normalized) {
    nativeFrequency.set(sample.nativeMs, (nativeFrequency.get(sample.nativeMs) ?? 0) + 1);
  }

  const distinctNativeTimestampCount = nativeFrequency.size;
  const repeatedNativeTimestampQuoteCount = normalized.length - distinctNativeTimestampCount;
  const maxQuotesPerNativeTimestamp = nativeFrequency.size ? Math.max(...nativeFrequency.values()) : 0;

  let classification = 'NO_SAMPLES';
  if (invalidSampleCount) classification = 'DATA_INVALID';
  else if (nativeRegressionCount) classification = 'NATIVE_TIMESTAMP_REGRESSION_OBSERVED';
  else if (arrivalRegressionCount) classification = 'ARRIVAL_TIMESTAMP_REGRESSION_OBSERVED';
  else if (repeatedNativeTimestampQuoteCount && arrivalAdvanceCount) classification = 'NATIVE_BUCKETING_WITH_ARRIVAL_ACTIVITY';
  else if (nativeAdvanceCount && arrivalAdvanceCount) classification = 'NATIVE_PROGRESSION_WITH_ARRIVAL_ACTIVITY';
  else if (normalized.length) classification = 'INSUFFICIENT_PROGRESSIVE_EVIDENCE';

  return Object.freeze({
    diagnosticVersion: TWELVE_WS_ARRIVAL_NATIVE_DIAGNOSTIC_VERSION,
    samplesObserved: input.length,
    validSamplesObserved: normalized.length,
    invalidSampleCount,
    distinctNativeTimestampCount,
    repeatedNativeTimestampQuoteCount,
    maxQuotesPerNativeTimestamp,
    nativeAdvanceCount,
    nativeRegressionCount,
    arrivalAdvanceCount,
    arrivalRegressionCount,
    minPositiveNativeStepMs: nativePositiveSteps.length ? Math.min(...nativePositiveSteps) : null,
    maxPositiveNativeStepMs: nativePositiveSteps.length ? Math.max(...nativePositiveSteps) : null,
    minPositiveArrivalStepMs: arrivalPositiveSteps.length ? Math.min(...arrivalPositiveSteps) : null,
    maxPositiveArrivalStepMs: arrivalPositiveSteps.length ? Math.max(...arrivalPositiveSteps) : null,
    classification,
    freshnessInterpretation: 'NOT_EVALUATED',
    providerCommissioning: false,
    decisionImpact: 'NONE',
    prospectivePaperAuthorized: false,
    ordersExecuted: 0,
    externalProviderCalls: 0,
    rawTimestampsExposed: false
  });
}
