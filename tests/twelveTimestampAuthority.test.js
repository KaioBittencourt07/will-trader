import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyTwelveTimestampAuthority } from '../backend/src/twelveTimestampAuthority.js';

test('keeps unresolved evidence fail closed', () => {
  const result = classifyTwelveTimestampAuthority();
  assert.equal(result.classification, 'UNRESOLVED');
  assert.equal(result.canEvaluateFrozenFreshness, false);
  assert.equal(result.providerCommissioning, false);
  assert.equal(result.prospectivePaperAuthorized, false);
});

test('client receive time is diagnostic only', () => {
  const result = classifyTwelveTimestampAuthority({ candidateAuthority: 'CLIENT_RECEIVE_TIME', provenanceVerified: true, comparableToReceiveClock: true });
  assert.equal(result.classification, 'CLIENT_RECEIVE_TIME_DIAGNOSTIC_ONLY');
  assert.equal(result.canEvaluateFrozenFreshness, false);
  assert.equal(result.arrivalTimeCanReplaceEventTime, false);
});

test('provider bucket time cannot bypass freshness', () => {
  const result = classifyTwelveTimestampAuthority({ candidateAuthority: 'PROVIDER_BUCKET_TIME', provenanceVerified: true, comparableToReceiveClock: true, observedBucketPattern: true });
  assert.equal(result.classification, 'PROVIDER_BUCKET_TIME_DESCRIPTIVE_ONLY');
  assert.equal(result.canEvaluateFrozenFreshness, false);
  assert.equal(result.bucketTimeCanBypassFreshness, false);
});

test('provider event time requires provenance and clock comparability', () => {
  const blocked = classifyTwelveTimestampAuthority({ candidateAuthority: 'PROVIDER_EVENT_TIME', provenanceVerified: false, comparableToReceiveClock: true });
  assert.equal(blocked.classification, 'UNRESOLVED');
  assert.equal(blocked.canEvaluateFrozenFreshness, false);

  const supported = classifyTwelveTimestampAuthority({ candidateAuthority: 'PROVIDER_EVENT_TIME', provenanceVerified: true, comparableToReceiveClock: true });
  assert.equal(supported.classification, 'PROVIDER_EVENT_TIME_SUPPORTED');
  assert.equal(supported.canEvaluateFrozenFreshness, true);
  assert.equal(supported.providerCommissioning, false);
});

test('exchange event time support still grants no trading authority', () => {
  const result = classifyTwelveTimestampAuthority({ candidateAuthority: 'EXCHANGE_EVENT_TIME', provenanceVerified: true, comparableToReceiveClock: true });
  assert.equal(result.classification, 'EXCHANGE_EVENT_TIME_SUPPORTED');
  assert.equal(result.canEvaluateFrozenFreshness, true);
  assert.equal(result.decisionImpact, 'NONE');
  assert.equal(result.prospectivePaperAuthorized, false);
  assert.equal(result.ordersExecuted, 0);
});

test('rejects any attempt to alter frozen 30 second contract', () => {
  const result = classifyTwelveTimestampAuthority({ freshnessContractMs: 60_000 });
  assert.equal(result.classification, 'DATA_INVALID');
  assert.deepEqual(result.reasonCodes, ['FROZEN_FRESHNESS_CONTRACT_CHANGED']);
  assert.equal(result.freshnessContractMs, 30_000);
});
