import assert from 'node:assert/strict';
import test from 'node:test';
import { qualifyTwelveRestTimestampSemantic } from '../backend/src/twelveRestTimestampSemanticQualification.js';

test('official quote timestamp is interval-open bucket time, not event time', () => {
  const result = qualifyTwelveRestTimestampSemantic('timestamp');
  assert.equal(result.classification, 'PROVIDER_BUCKET_TIME');
  assert.equal(result.candidateAuthority, 'PROVIDER_BUCKET_TIME');
  assert.equal(result.provenanceVerified, true);
  assert.equal(result.observedBucketPattern, true);
  assert.equal(result.canEvaluateFrozenFreshness, false);
  assert.equal(result.freshnessContractMs, 30_000);
});

test('last_update_at remains unresolved without explicit per-event provenance', () => {
  const result = qualifyTwelveRestTimestampSemantic('last_update_at');
  assert.equal(result.classification, 'RECENT_QUOTE_TIME_SEMANTICS_UNRESOLVED');
  assert.equal(result.candidateAuthority, 'UNRESOLVED');
  assert.equal(result.provenanceVerified, false);
  assert.equal(result.canEvaluateFrozenFreshness, false);
});

test('last_quote_at remains unresolved and cannot authorize freshness', () => {
  const result = qualifyTwelveRestTimestampSemantic('last_quote_at');
  assert.equal(result.classification, 'LAST_QUOTE_AT_SEMANTICS_UNRESOLVED');
  assert.equal(result.candidateAuthority, 'UNRESOLVED');
  assert.equal(result.comparableToReceiveClock, false);
  assert.equal(result.canEvaluateFrozenFreshness, false);
});

test('unknown timestamp field fails closed', () => {
  const result = qualifyTwelveRestTimestampSemantic('mystery_time');
  assert.equal(result.classification, 'DATA_INVALID');
  assert.equal(result.canEvaluateFrozenFreshness, false);
  assert.deepEqual(result.reasonCodes, ['TIMESTAMP_FIELD_UNKNOWN']);
});

test('semantic qualification never commissions provider or authorizes PAPER', () => {
  for (const fieldName of ['timestamp', 'last_update_at', 'last_quote_at']) {
    const result = qualifyTwelveRestTimestampSemantic(fieldName);
    assert.equal(result.providerCommissioning, false);
    assert.equal(result.decisionImpact, 'NONE');
    assert.equal(result.prospectivePaperAuthorized, false);
    assert.equal(result.ordersExecuted, 0);
    assert.equal(result.externalProviderCalls, 0);
  }
});
