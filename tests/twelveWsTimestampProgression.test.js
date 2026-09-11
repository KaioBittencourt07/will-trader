import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnoseTwelveWsTimestampProgression } from '../backend/src/twelveWsTimestampProgression.js';

test('all quotes sharing one native timestamp remain descriptive', () => {
  const report = diagnoseTwelveWsTimestampProgression([100, 100, 100]);
  assert.equal(report.timestampProgressionClassification, 'SINGLE_TIMESTAMP_ONLY'); assert.equal(report.distinctNativeEventTimestampCount, 1);
  assert.equal(report.repeatedTimestampQuoteCount, 2); assert.equal(report.maxQuotesSharingNativeTimestamp, 3); assert.equal(report.nativeTimestampProgressed, 'NOT_OBSERVED');
});
test('repeat followed by advance is measured without a quality verdict', () => {
  const report = diagnoseTwelveWsTimestampProgression([100, 100, 101]);
  assert.equal(report.timestampProgressionClassification, 'REPEATED_TIMESTAMP_PATTERN_OBSERVED'); assert.equal(report.timestampAdvanceCount, 1);
  assert.equal(report.minPositiveTimestampStepMs, 1000); assert.equal(report.maxPositiveTimestampStepMs, 1000); assert.equal(report.nativeTimestampProgressed, 'DESCRIPTIVE_ONLY');
});
test('multiple advances expose only positive deltas', () => {
  const report = diagnoseTwelveWsTimestampProgression([100, 102, 105]);
  assert.equal(report.timestampProgressionClassification, 'TIMESTAMP_PROGRESSION_OBSERVED'); assert.equal(report.timestampAdvanceCount, 2);
  assert.equal(report.minPositiveTimestampStepMs, 2000); assert.equal(report.maxPositiveTimestampStepMs, 3000);
});
test('regression fails closed independently of repeats', () => {
  const report = diagnoseTwelveWsTimestampProgression([100, 102, 101, 101]);
  assert.equal(report.timestampProgressionClassification, 'TIMESTAMP_REGRESSION_OBSERVED'); assert.equal(report.timestampRegressionCount, 1);
});
test('missing non-finite unsafe and ambiguous-unit timestamps are data invalid', () => {
  for (const [values, unit] of [[[100, null], 'UNIX_SECONDS'], [[100, 'bad'], 'UNIX_SECONDS'], [[Number.MAX_SAFE_INTEGER], 'UNIX_SECONDS'], [[100], null]]) {
    const report = diagnoseTwelveWsTimestampProgression(values, unit); assert.equal(report.timestampProgressionClassification, 'DATA_INVALID'); assert.ok(report.invalidTimestampCount > 0);
  }
});
test('no quote is explicit and never claims progression', () => {
  const report = diagnoseTwelveWsTimestampProgression([]); assert.equal(report.timestampProgressionClassification, 'NO_QUOTE_OBSERVED');
  assert.equal(report.timestampSamplesObserved, 0); assert.equal(report.nativeTimestampProgressed, 'NOT_OBSERVED');
});
test('output is allowlisted aggregate evidence without absolute timestamps', () => {
  const report = diagnoseTwelveWsTimestampProgression([1_800_000_000, 1_800_000_001]); const text = JSON.stringify(report);
  for (const forbidden of ['1800000000', 'price', 'apikey=', 'wss://', 'SYNTHETIC_SECRET']) assert.equal(text.includes(forbidden), false);
  assert.deepEqual(Object.keys(report).sort(), ['distinctNativeEventTimestampCount', 'invalidTimestampCount', 'maxPositiveTimestampStepMs',
    'maxQuotesSharingNativeTimestamp', 'minPositiveTimestampStepMs', 'nativeTimestampProgressed', 'repeatedTimestampQuoteCount',
    'timestampAdvanceCount', 'timestampProgressionClassification', 'timestampProgressionVersion', 'timestampRegressionCount',
    'timestampSamplesObserved', 'validTimestampSamplesObserved'].sort());
});
