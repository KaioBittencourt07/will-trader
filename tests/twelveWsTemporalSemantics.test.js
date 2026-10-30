import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnoseTwelveWsTemporalSemantics } from '../backend/src/twelveWsTemporalSemantics.js';

const sample = (nativeTimestamp, receiveTimestamp) => ({ nativeTimestamp, receiveTimestamp });

test('supports minute bucket pattern only as descriptive offline evidence', () => {
  const result = diagnoseTwelveWsTemporalSemantics([
    sample(1_700_000_000, 1_700_000_000_100),
    sample(1_700_000_000, 1_700_000_001_100),
    sample(1_700_000_000, 1_700_000_002_100),
    sample(1_700_000_060, 1_700_000_060_100),
    sample(1_700_000_060, 1_700_000_061_100)
  ]);

  assert.equal(result.temporalSemanticsClassification, 'MINUTE_BUCKET_PATTERN_SUPPORTED');
  assert.equal(result.nativeTimestampSemantics, 'LIKELY_MINUTE_BUCKET_MARKER_DESCRIPTIVE_ONLY');
  assert.equal(result.minPositiveNativeStepMs, 60_000);
  assert.equal(result.maxPositiveNativeStepMs, 60_000);
  assert.equal(result.repeatedNativeTimestampQuoteCount, 3);
  assert.equal(result.arrivalAdvanceCount, 4);
  assert.equal(result.freshnessContractMs, 30_000);
  assert.equal(result.freshnessContractChanged, false);
  assert.equal(result.arrivalTimeRole, 'TRANSPORT_CADENCE_DIAGNOSTIC_ONLY');
  assert.equal(result.providerCommissioning, false);
  assert.equal(result.prospectivePaperAuthorized, false);
  assert.equal(result.ordersExecuted, 0);
  assert.equal(result.externalProviderCalls, 0);
});

test('does not call arbitrary progressive event time a minute bucket', () => {
  const result = diagnoseTwelveWsTemporalSemantics([
    sample(100, 100_100),
    sample(101, 101_100),
    sample(102, 102_100)
  ]);

  assert.equal(result.temporalSemanticsClassification, 'NATIVE_EVENT_TIME_PROGRESSION_SUPPORTED');
  assert.equal(result.nativeTimestampSemantics, 'EVENT_TIME_PROGRESSIVE_DESCRIPTIVE_ONLY');
  assert.equal(result.freshnessContractChanged, false);
});

test('native regression fails closed', () => {
  const result = diagnoseTwelveWsTemporalSemantics([
    sample(200, 200_100),
    sample(199, 201_100)
  ]);

  assert.equal(result.temporalSemanticsClassification, 'TEMPORAL_REGRESSION_OBSERVED');
  assert.equal(result.providerCommissioning, false);
  assert.equal(result.decisionImpact, 'NONE');
});

test('arrival regression fails closed', () => {
  const result = diagnoseTwelveWsTemporalSemantics([
    sample(300, 300_100),
    sample(301, 299_100)
  ]);

  assert.equal(result.temporalSemanticsClassification, 'TEMPORAL_REGRESSION_OBSERVED');
  assert.equal(result.arrivalRegressionCount, 1);
});

test('invalid samples remain invalid and raw timestamps are not returned', () => {
  const result = diagnoseTwelveWsTemporalSemantics([
    sample(400, 400_100),
    sample('bad', 401_100)
  ]);

  assert.equal(result.temporalSemanticsClassification, 'DATA_INVALID');
  assert.equal(result.rawTimestampsExposed, false);
  assert.equal(JSON.stringify(result).includes('400100'), false);
});

test('single native timestamp is insufficient to infer minute semantics', () => {
  const result = diagnoseTwelveWsTemporalSemantics([
    sample(500, 500_100),
    sample(500, 501_100),
    sample(500, 502_100)
  ]);

  assert.equal(result.temporalSemanticsClassification, 'INSUFFICIENT_PROGRESSIVE_EVIDENCE');
  assert.equal(result.nativeTimestampSemantics, 'UNRESOLVED');
  assert.equal(result.externalProviderCalls, 0);
});
