import assert from 'node:assert/strict';
import test from 'node:test';
import { runTwelveR8jExecution, TWELVE_R8J_AUTHORIZATION, TWELVE_R8J_LIMITS } from '../backend/src/twelveR8jExecution.js';

const env = {
  WILL_TWELVE_R8J_ENABLED: 'true',
  WILL_TWELVE_R8J_AUTHORIZATION: TWELVE_R8J_AUTHORIZATION,
  TWELVEDATA_API_KEY: 'SYNTHETIC_SECRET'
};

const observed = {
  observationVersion: 'twelve-ws-freshness-observation-v1',
  connections: 1,
  subscribeAttempts: 1,
  subscribeAccepted: true,
  quoteMessagesObserved: 4,
  observationWindowMs: 60_000,
  preAcceptTimeoutMs: 5_000,
  heartbeatIntervalMs: 10_000,
  heartbeatsSent: 5,
  closeCode: null,
  retries: 0,
  reconnects: 0,
  redirects: 0,
  applicationMessagesSent: 6,
  freshnessSamplesObserved: 4,
  freshnessPassCount: 2,
  freshnessFailCount: 2,
  freshnessInvalidCount: 0,
  freshnessUnverifiedCount: 0,
  minEventAgeMs: 1_000,
  maxEventAgeMs: 40_000,
  lastEventAgeMs: 2_000,
  classification: 'FRESHNESS_CONTRACT_FAILED',
  freshnessEvidence: {
    freshnessVersion: 'twelve-ws-event-freshness-v1',
    eventTimestampObserved: true,
    receiveTimestampObserved: true,
    eventAgeMs: 40_000,
    freshnessContractMs: 30_000,
    freshnessGate: 'FAIL',
    blocker: 'EVENT_OLDER_THAN_FROZEN_CONTRACT',
    clockComparabilityGate: 'PASS',
    timestampUnitGate: 'PASS',
    futureTimestampGate: 'PASS',
    providerCommissioning: false,
    decisionImpact: 'NONE',
    prospectivePaperAuthorized: false,
    ordersExecuted: 0,
    externalProviderCalls: 0
  },
  timestampProgressionVersion: 'twelve-ws-timestamp-progression-v1',
  timestampSamplesObserved: 4,
  validTimestampSamplesObserved: 4,
  invalidTimestampCount: 0,
  distinctNativeEventTimestampCount: 2,
  repeatedTimestampQuoteCount: 2,
  timestampAdvanceCount: 1,
  timestampRegressionCount: 0,
  minPositiveTimestampStepMs: 60_000,
  maxPositiveTimestampStepMs: 60_000,
  maxQuotesSharingNativeTimestamp: 3,
  nativeTimestampProgressed: 'DESCRIPTIVE_ONLY',
  timestampProgressionClassification: 'REPEATED_TIMESTAMP_PATTERN_OBSERVED',
  arrivalNativeDiagnostic: {
    diagnosticVersion: 'twelve-ws-arrival-native-diagnostic-v1',
    samplesObserved: 4,
    validSamplesObserved: 4,
    invalidSampleCount: 0,
    distinctNativeTimestampCount: 2,
    repeatedNativeTimestampQuoteCount: 2,
    maxQuotesPerNativeTimestamp: 3,
    nativeAdvanceCount: 1,
    nativeRegressionCount: 0,
    arrivalAdvanceCount: 3,
    arrivalRegressionCount: 0,
    minPositiveNativeStepMs: 60_000,
    maxPositiveNativeStepMs: 60_000,
    minPositiveArrivalStepMs: 1_000,
    maxPositiveArrivalStepMs: 58_000,
    classification: 'NATIVE_BUCKETING_WITH_ARRIVAL_ACTIVITY',
    freshnessInterpretation: 'NOT_EVALUATED',
    providerCommissioning: false,
    decisionImpact: 'NONE',
    prospectivePaperAuthorized: false,
    ordersExecuted: 0,
    externalProviderCalls: 0,
    rawTimestampsExposed: false
  },
  providerCommissioning: false,
  decisionImpact: 'NONE',
  prospectivePaperAuthorized: false,
  ordersExecuted: 0,
  externalProviderCalls: 1,
  restRequests: 0,
  saxoRequests: 0,
  secretExposed: false
};

test('missing wrong and historical authorizations fail before observer access', async () => {
  for (const patch of [
    { WILL_TWELVE_R8J_ENABLED: 'false' },
    { WILL_TWELVE_R8J_AUTHORIZATION: 'WRONG' },
    { WILL_TWELVE_R8J_AUTHORIZATION: 'R8I_TIMESTAMP_PROGRESSION_EXPLICITLY_AUTHORIZED' },
    { TWELVEDATA_API_KEY: '' }
  ]) {
    let calls = 0;
    const report = await runTwelveR8jExecution({
      env: { ...env, ...patch },
      observer: async () => { calls += 1; return observed; }
    });
    assert.equal(report.result, 'BLOCKED');
    assert.equal(report.externalProviderCalls, 0);
    assert.equal(calls, 0);
  }
});

test('exact R8J authorization invokes observer once with frozen bounds and temporal opt-in', async () => {
  let calls = 0;
  let options;
  const report = await runTwelveR8jExecution({
    env,
    observer: async (value) => { calls += 1; options = value; return observed; }
  });
  assert.equal(calls, 1);
  assert.equal(options.authorization, TWELVE_R8J_AUTHORIZATION);
  assert.equal(options.includeArrivalNativeDiagnostic, true);
  assert.equal(options.observationWindowMs, TWELVE_R8J_LIMITS.observationWindowMs);
  assert.equal(options.preAcceptTimeoutMs, TWELVE_R8J_LIMITS.preAcceptTimeoutMs);
  assert.equal(options.heartbeatIntervalMs, TWELVE_R8J_LIMITS.heartbeatIntervalMs);
  assert.equal(report.result, 'OBSERVED');
});

test('temporal bucket evidence stays descriptive and does not authorize PAPER', async () => {
  const report = await runTwelveR8jExecution({ env, observer: async () => observed });
  assert.equal(report.arrivalNativeDiagnostic.classification, 'NATIVE_BUCKETING_WITH_ARRIVAL_ACTIVITY');
  assert.equal(report.arrivalNativeDiagnostic.rawTimestampsExposed, false);
  assert.equal(report.freshnessEvidence.freshnessContractMs, 30_000);
  assert.equal(report.providerCommissioning, false);
  assert.equal(report.decisionImpact, 'NONE');
  assert.equal(report.prospectivePaperAuthorized, false);
  assert.equal(report.ordersExecuted, 0);
});

test('out-of-bounds top-level observations fail closed without secret echo', async () => {
  for (const mutation of [
    { connections: 2 }, { subscribeAttempts: 2 }, { retries: 1 }, { reconnects: 1 },
    { restRequests: 1 }, { externalProviderCalls: 2 }, { observationWindowMs: 60_001 },
    { heartbeatIntervalMs: 9_999 }, { rawPrice: 9.9 }, { apiKey: 'SYNTHETIC_SECRET' }
  ]) {
    const report = await runTwelveR8jExecution({ env, observer: async () => ({ ...observed, ...mutation }) });
    const text = JSON.stringify(report);
    assert.equal(report.result, 'BLOCKED');
    assert.equal(report.externalProviderCalls, 0);
    assert.equal(text.includes('SYNTHETIC_SECRET'), false);
    assert.equal(text.includes('9.9'), false);
  }
});

test('raw temporal timestamps and altered freshness contract fail closed', async () => {
  const rawTemporal = await runTwelveR8jExecution({ env, observer: async () => ({
    ...observed,
    arrivalNativeDiagnostic: { ...observed.arrivalNativeDiagnostic, nativeTimestamp: 1_800_000_000 }
  }) });
  assert.equal(rawTemporal.result, 'BLOCKED');

  const changedContract = await runTwelveR8jExecution({ env, observer: async () => ({
    ...observed,
    freshnessEvidence: { ...observed.freshnessEvidence, freshnessContractMs: 60_000 }
  }) });
  assert.equal(changedContract.result, 'BLOCKED');
});

test('nested temporal authority escalation fails closed', async () => {
  const report = await runTwelveR8jExecution({ env, observer: async () => ({
    ...observed,
    arrivalNativeDiagnostic: { ...observed.arrivalNativeDiagnostic, prospectivePaperAuthorized: true }
  }) });
  assert.equal(report.result, 'BLOCKED');
  assert.equal(report.prospectivePaperAuthorized, false);
  assert.equal(report.ordersExecuted, 0);
});
