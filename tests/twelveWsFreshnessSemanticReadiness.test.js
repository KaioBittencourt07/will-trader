import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateTwelveWsFreshnessSemanticReadiness } from '../backend/src/twelveWsFreshnessSemanticReadiness.js';

test('documented unix timestamp plus realtime ticks does not prove per-tick event time', () => {
  const result = evaluateTwelveWsFreshnessSemanticReadiness({
    providerDocumentsTimestampAsUnix: true,
    providerDocumentsPriceEventsAsRealtimeTicks: true,
    providerDocumentsTimestampAsPerTickEventTime: false,
    observedMinuteBucketPattern: true,
    frozenFreshnessContractMs: 30_000
  });
  assert.equal(result.classification, 'FRESHNESS_SEMANTICS_UNVERIFIED');
  assert.equal(result.blocker, 'PER_TICK_EVENT_TIME_SEMANTICS_NOT_PROVEN');
  assert.equal(result.arrivalTimeCanReplaceEventTime, false);
  assert.equal(result.bucketSemanticsCanBypassFreshness, false);
  assert.equal(result.providerCommissioning, false);
  assert.equal(result.prospectivePaperAuthorized, false);
  assert.equal(result.ordersExecuted, 0);
  assert.equal(result.externalProviderCalls, 0);
});

test('only explicit per-tick event-time documentation can support that semantic classification', () => {
  const result = evaluateTwelveWsFreshnessSemanticReadiness({
    providerDocumentsTimestampAsUnix: true,
    providerDocumentsTimestampAsPerTickEventTime: true,
    frozenFreshnessContractMs: 30_000
  });
  assert.equal(result.classification, 'PER_TICK_EVENT_TIME_SEMANTICS_SUPPORTED');
  assert.equal(result.blocker, null);
  assert.equal(result.freshnessContractChanged, false);
  assert.equal(result.providerCommissioning, false);
});

test('attempt to change frozen 30 second contract fails closed', () => {
  const result = evaluateTwelveWsFreshnessSemanticReadiness({ frozenFreshnessContractMs: 60_000 });
  assert.equal(result.classification, 'DATA_INVALID');
  assert.equal(result.blocker, 'FROZEN_FRESHNESS_CONTRACT_CHANGED');
  assert.equal(result.freshnessContractMs, 30_000);
});

test('unknown evidence fails closed', () => {
  const result = evaluateTwelveWsFreshnessSemanticReadiness({ rawTimestamp: 123 });
  assert.equal(result.classification, 'DATA_INVALID');
  assert.equal(result.blocker, 'UNSANITIZED_OR_UNKNOWN_EVIDENCE');
  assert.equal(JSON.stringify(result).includes('123'), false);
});
