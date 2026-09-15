import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnoseTwelveWsArrivalNative } from '../backend/src/twelveWsArrivalNativeDiagnostic.js';

const sample = (nativeTimestamp, receiveTimestamp) => ({ nativeTimestamp, receiveTimestamp });

test('classifies repeated native buckets while arrival time continues to advance', () => {
  const result = diagnoseTwelveWsArrivalNative([
    sample(1_700_000_000, 1_700_000_000_100),
    sample(1_700_000_000, 1_700_000_001_100),
    sample(1_700_000_000, 1_700_000_002_100),
    sample(1_700_000_060, 1_700_000_060_100)
  ]);

  assert.equal(result.classification, 'NATIVE_BUCKETING_WITH_ARRIVAL_ACTIVITY');
  assert.equal(result.distinctNativeTimestampCount, 2);
  assert.equal(result.repeatedNativeTimestampQuoteCount, 2);
  assert.equal(result.maxQuotesPerNativeTimestamp, 3);
  assert.equal(result.nativeAdvanceCount, 1);
  assert.equal(result.nativeRegressionCount, 0);
  assert.equal(result.arrivalAdvanceCount, 3);
  assert.equal(result.minPositiveNativeStepMs, 60_000);
  assert.equal(result.maxPositiveNativeStepMs, 60_000);
  assert.equal(result.externalProviderCalls, 0);
  assert.equal(result.prospectivePaperAuthorized, false);
});

test('keeps clean progression descriptive and separate from freshness', () => {
  const result = diagnoseTwelveWsArrivalNative([
    sample(100, 100_100),
    sample(101, 101_100),
    sample(102, 102_100)
  ]);

  assert.equal(result.classification, 'NATIVE_PROGRESSION_WITH_ARRIVAL_ACTIVITY');
  assert.equal(result.repeatedNativeTimestampQuoteCount, 0);
  assert.equal(result.nativeAdvanceCount, 2);
  assert.equal(result.arrivalAdvanceCount, 2);
  assert.equal(result.freshnessInterpretation, 'NOT_EVALUATED');
  assert.equal(result.providerCommissioning, false);
  assert.equal(result.decisionImpact, 'NONE');
});

test('native timestamp regression fails closed descriptively', () => {
  const result = diagnoseTwelveWsArrivalNative([
    sample(200, 200_100),
    sample(199, 201_100)
  ]);

  assert.equal(result.classification, 'NATIVE_TIMESTAMP_REGRESSION_OBSERVED');
  assert.equal(result.nativeRegressionCount, 1);
  assert.equal(result.providerCommissioning, false);
  assert.equal(result.ordersExecuted, 0);
});

test('invalid samples are classified DATA_INVALID without exposing raw timestamps', () => {
  const result = diagnoseTwelveWsArrivalNative([
    sample(300, 300_100),
    sample('bad', 301_100)
  ]);

  assert.equal(result.classification, 'DATA_INVALID');
  assert.equal(result.samplesObserved, 2);
  assert.equal(result.validSamplesObserved, 1);
  assert.equal(result.invalidSampleCount, 1);
  assert.equal(result.rawTimestampsExposed, false);
  assert.equal(JSON.stringify(result).includes('300100'), false);
});

test('non-array input fails closed as invalid data', () => {
  const result = diagnoseTwelveWsArrivalNative(null);
  assert.equal(result.classification, 'DATA_INVALID');
  assert.equal(result.invalidSampleCount, 1);
  assert.equal(result.externalProviderCalls, 0);
});
