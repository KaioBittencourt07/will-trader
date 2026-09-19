import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyTwelveWsObservationState } from '../backend/src/twelveWsObservationState.js';

const baseObservation = () => ({
  connections: 1,
  subscribeAttempts: 1,
  subscribeAccepted: true,
  quoteMessagesObserved: 29,
  freshnessSamplesObserved: 29,
  freshnessPassCount: 13,
  freshnessFailCount: 16,
  classification: 'FRESHNESS_CONTRACT_FAILED',
  freshnessEvidence: { freshnessContractMs: 30_000 },
  arrivalNativeDiagnostic: {
    validSamplesObserved: 29,
    nativeRegressionCount: 0,
    arrivalRegressionCount: 0,
    arrivalAdvanceCount: 28,
    minPositiveNativeStepMs: 60_000,
    maxPositiveNativeStepMs: 60_000,
    classification: 'NATIVE_BUCKETING_WITH_ARRIVAL_ACTIVITY',
    providerCommissioning: false,
    decisionImpact: 'NONE',
    prospectivePaperAuthorized: false,
    ordersExecuted: 0,
    rawTimestampsExposed: false
  },
  providerCommissioning: false,
  decisionImpact: 'NONE',
  prospectivePaperAuthorized: false,
  ordersExecuted: 0
});

test('classifies the observed R8J pattern without weakening freshness', () => {
  const result = classifyTwelveWsObservationState(baseObservation());
  assert.equal(result.classification, 'TRANSPORT_ACTIVE_NATIVE_BUCKETED_FRESHNESS_FAILED');
  assert.equal(result.transportState, 'ACTIVE');
  assert.equal(result.nativeTimestampState, 'MINUTE_BUCKET_PATTERN_SUPPORTED');
  assert.equal(result.freshnessState, 'FAILED');
  assert.equal(result.freshnessContractMs, 30_000);
  assert.equal(result.freshnessContractChanged, false);
  assert.equal(result.arrivalTimeRole, 'TRANSPORT_CADENCE_DIAGNOSTIC_ONLY');
  assert.equal(result.providerCommissioning, false);
  assert.equal(result.prospectivePaperAuthorized, false);
  assert.equal(result.ordersExecuted, 0);
});

test('freshness pass remains descriptive and does not authorize PAPER', () => {
  const observation = baseObservation();
  observation.freshnessPassCount = 29;
  observation.freshnessFailCount = 0;
  observation.classification = 'FRESHNESS_PASS_OBSERVED';
  const result = classifyTwelveWsObservationState(observation);
  assert.equal(result.classification, 'TRANSPORT_ACTIVE_NATIVE_BUCKETED_FRESHNESS_PASS_OBSERVED');
  assert.equal(result.freshnessState, 'PASS_OBSERVED');
  assert.equal(result.providerCommissioning, false);
  assert.equal(result.prospectivePaperAuthorized, false);
  assert.equal(result.ordersExecuted, 0);
});

test('transport inactivity cannot be masked by timestamp semantics', () => {
  const observation = baseObservation();
  observation.connections = 0;
  observation.subscribeAttempts = 0;
  observation.subscribeAccepted = false;
  observation.quoteMessagesObserved = 0;
  const result = classifyTwelveWsObservationState(observation);
  assert.equal(result.classification, 'TRANSPORT_INACTIVE_OR_INCONCLUSIVE');
  assert.equal(result.transportState, 'INACTIVE_OR_INCONCLUSIVE');
  assert.equal(result.nativeTimestampState, 'MINUTE_BUCKET_PATTERN_SUPPORTED');
});

test('native or arrival regression fails closed as a separate temporal state', () => {
  for (const field of ['nativeRegressionCount', 'arrivalRegressionCount']) {
    const observation = baseObservation();
    observation.arrivalNativeDiagnostic[field] = 1;
    const result = classifyTwelveWsObservationState(observation);
    assert.equal(result.classification, 'TEMPORAL_REGRESSION_OBSERVED');
    assert.equal(result.nativeTimestampState, 'REGRESSION_OBSERVED');
    assert.equal(result.decisionImpact, 'NONE');
  }
});

test('wrong freshness contract is rejected instead of recalibrated', () => {
  const observation = baseObservation();
  observation.freshnessEvidence.freshnessContractMs = 60_000;
  const result = classifyTwelveWsObservationState(observation);
  assert.equal(result.classification, 'DATA_INVALID');
  assert.equal(result.freshnessContractMs, 30_000);
  assert.equal(result.freshnessContractChanged, false);
});

test('authority or raw timestamp invariant violations fail closed', () => {
  for (const mutate of [
    (observation) => { observation.providerCommissioning = true; },
    (observation) => { observation.prospectivePaperAuthorized = true; },
    (observation) => { observation.ordersExecuted = 1; },
    (observation) => { observation.arrivalNativeDiagnostic.rawTimestampsExposed = true; }
  ]) {
    const observation = baseObservation();
    mutate(observation);
    const result = classifyTwelveWsObservationState(observation);
    assert.equal(result.classification, 'DATA_INVALID');
    assert.equal(result.providerCommissioning, false);
    assert.equal(result.prospectivePaperAuthorized, false);
    assert.equal(result.ordersExecuted, 0);
  }
});
