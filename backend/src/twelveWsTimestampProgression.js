export const TWELVE_WS_TIMESTAMP_PROGRESSION_VERSION = 'twelve-ws-timestamp-progression-v1';
const UNIT_MS = Object.freeze({ UNIX_SECONDS: 1_000 });

export function diagnoseTwelveWsTimestampProgression(timestamps = [], timestampUnit = 'UNIX_SECONDS') {
  const input = Array.isArray(timestamps) ? timestamps : [];
  const multiplier = UNIT_MS[timestampUnit]; const normalized = [];
  let invalidTimestampCount = Array.isArray(timestamps) ? 0 : 1;
  for (const timestamp of input) {
    const value = timestamp * multiplier;
    if (!multiplier || !Number.isFinite(timestamp) || !Number.isSafeInteger(value)) invalidTimestampCount += 1;
    else normalized.push(value);
  }
  let timestampAdvanceCount = 0; let timestampRegressionCount = 0; const positiveSteps = [];
  for (let index = 1; index < normalized.length; index += 1) {
    const step = normalized[index] - normalized[index - 1];
    if (step > 0) { timestampAdvanceCount += 1; positiveSteps.push(step); }
    if (step < 0) timestampRegressionCount += 1;
  }
  const frequencies = new Map(); for (const value of normalized) frequencies.set(value, (frequencies.get(value) ?? 0) + 1);
  const distinctNativeEventTimestampCount = frequencies.size;
  const repeatedTimestampQuoteCount = normalized.length - distinctNativeEventTimestampCount;
  const maxQuotesSharingNativeTimestamp = frequencies.size ? Math.max(...frequencies.values()) : 0;
  let timestampProgressionClassification = 'NO_QUOTE_OBSERVED';
  if (invalidTimestampCount) timestampProgressionClassification = 'DATA_INVALID';
  else if (timestampRegressionCount) timestampProgressionClassification = 'TIMESTAMP_REGRESSION_OBSERVED';
  else if (normalized.length && distinctNativeEventTimestampCount === 1) timestampProgressionClassification = 'SINGLE_TIMESTAMP_ONLY';
  else if (repeatedTimestampQuoteCount) timestampProgressionClassification = 'REPEATED_TIMESTAMP_PATTERN_OBSERVED';
  else if (timestampAdvanceCount) timestampProgressionClassification = 'TIMESTAMP_PROGRESSION_OBSERVED';
  return Object.freeze({ timestampProgressionVersion: TWELVE_WS_TIMESTAMP_PROGRESSION_VERSION,
    timestampSamplesObserved: input.length, validTimestampSamplesObserved: normalized.length, invalidTimestampCount,
    distinctNativeEventTimestampCount, repeatedTimestampQuoteCount, timestampAdvanceCount, timestampRegressionCount,
    minPositiveTimestampStepMs: positiveSteps.length ? Math.min(...positiveSteps) : null,
    maxPositiveTimestampStepMs: positiveSteps.length ? Math.max(...positiveSteps) : null,
    maxQuotesSharingNativeTimestamp, nativeTimestampProgressed: timestampAdvanceCount ? 'DESCRIPTIVE_ONLY' : 'NOT_OBSERVED',
    timestampProgressionClassification });
}
