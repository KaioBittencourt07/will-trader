import assert from 'node:assert/strict';
import test from 'node:test';
import { runTwelveR8iExecution, TWELVE_R8I_AUTHORIZATION, TWELVE_R8I_LIMITS } from '../backend/src/twelveR8iExecution.js';

const env = { WILL_TWELVE_R8I_ENABLED: 'true', WILL_TWELVE_R8I_AUTHORIZATION: TWELVE_R8I_AUTHORIZATION, TWELVEDATA_API_KEY: 'SYNTHETIC_SECRET' };
const observed = { observationVersion: 'twelve-ws-freshness-observation-v1', connections: 1, subscribeAttempts: 1,
  subscribeAccepted: true, quoteMessagesObserved: 3, observationWindowMs: 60000, preAcceptTimeoutMs: 5000,
  heartbeatIntervalMs: 10000, retries: 0, reconnects: 0, redirects: 0, restRequests: 0, saxoRequests: 0,
  timestampProgressionClassification: 'REPEATED_TIMESTAMP_PATTERN_OBSERVED', distinctNativeEventTimestampCount: 2,
  repeatedTimestampQuoteCount: 1, timestampAdvanceCount: 1, timestampRegressionCount: 0,
  freshnessEvidence: { freshnessVersion: 'twelve-ws-event-freshness-v1', eventTimestampObserved: true, receiveTimestampObserved: true,
    eventAgeMs: 1000, freshnessContractMs: 30000, freshnessGate: 'PASS', blocker: null, clockComparabilityGate: 'PASS',
    timestampUnitGate: 'PASS', futureTimestampGate: 'PASS', providerCommissioning: false, decisionImpact: 'NONE',
    prospectivePaperAuthorized: false, ordersExecuted: 0, externalProviderCalls: 0 },
  providerCommissioning: false, decisionImpact: 'NONE', prospectivePaperAuthorized: false, ordersExecuted: 0,
  externalProviderCalls: 1, secretExposed: false };

test('missing incorrect and historical R8H authorization fail before observer access', async () => {
  for (const patch of [{ WILL_TWELVE_R8I_ENABLED: 'false' }, { WILL_TWELVE_R8I_AUTHORIZATION: 'WRONG' },
    { WILL_TWELVE_R8I_AUTHORIZATION: 'R8H_FRESHNESS_OBSERVATION_EXPLICITLY_AUTHORIZED' }, { TWELVEDATA_API_KEY: '' }]) {
    let calls = 0; const report = await runTwelveR8iExecution({ env: { ...env, ...patch }, observer: async () => { calls += 1; return observed; } });
    assert.equal(report.result, 'BLOCKED'); assert.equal(report.externalProviderCalls, 0); assert.equal(calls, 0);
  }
});
test('exact R8I authorization invokes observer once with frozen bounds', async () => {
  let calls = 0; let options;
  const report = await runTwelveR8iExecution({ env, observer: async (value) => { calls += 1; options = value; return observed; } });
  assert.equal(calls, 1); assert.equal(options.authorization, TWELVE_R8I_AUTHORIZATION); assert.equal(options.apiKey, 'SYNTHETIC_SECRET');
  assert.equal(options.observationWindowMs, TWELVE_R8I_LIMITS.observationWindowMs); assert.equal(options.preAcceptTimeoutMs, 5000);
  assert.equal(options.heartbeatIntervalMs, 10000); assert.equal(report.result, 'OBSERVED');
});
test('progression repetition and regression remain sanitized non-authoritative evidence', async () => {
  for (const timestampProgressionClassification of ['TIMESTAMP_PROGRESSION_OBSERVED', 'REPEATED_TIMESTAMP_PATTERN_OBSERVED', 'TIMESTAMP_REGRESSION_OBSERVED']) {
    const report = await runTwelveR8iExecution({ env, observer: async () => ({ ...observed, timestampProgressionClassification }) });
    assert.equal(report.timestampProgressionClassification, timestampProgressionClassification); assert.equal(report.providerCommissioning, false);
    assert.equal(report.prospectivePaperAuthorized, false); assert.equal(report.ordersExecuted, 0);
  }
});
test('out-of-bounds or unsanitized observer output fails closed without echo', async () => {
  for (const mutation of [{ connections: 2 }, { subscribeAttempts: 2 }, { retries: 1 }, { reconnects: 1 },
    { restRequests: 1 }, { externalProviderCalls: 2 }, { observationWindowMs: 60001 }, { heartbeatIntervalMs: 9999 }, { rawPrice: 9.9 }, { apiKey: 'SYNTHETIC_SECRET' }]) {
    const report = await runTwelveR8iExecution({ env, observer: async () => ({ ...observed, ...mutation }) }); const text = JSON.stringify(report);
    assert.equal(report.result, 'BLOCKED'); assert.equal(report.externalProviderCalls, 0); assert.equal(text.includes('SYNTHETIC_SECRET'), false); assert.equal(text.includes('9.9'), false);
  }
});
test('nested raw freshness fields are rejected without exposure', async () => {
  const report = await runTwelveR8iExecution({ env, observer: async () => ({ ...observed,
    freshnessEvidence: { ...observed.freshnessEvidence, eventTimestamp: 1_800_000_000, apiKey: 'SYNTHETIC_SECRET' } }) });
  assert.equal(report.result, 'BLOCKED'); assert.equal(JSON.stringify(report).includes('SYNTHETIC_SECRET'), false);
});
