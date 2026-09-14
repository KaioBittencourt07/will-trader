import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifyTwelveWsEventTimeSemantic } from '../backend/src/twelveWsEventTimeSemanticQualification.js';

test('qualifies official Twelve price websocket timestamp semantics', () => {
  const result = qualifyTwelveWsEventTimeSemantic();
  assert.equal(result.provenanceVerified, true);
  assert.equal(result.semanticClassification, 'PROVIDER_REALTIME_TICK_UNIX_TIMESTAMP');
  assert.equal(result.comparableToReceiveClock, true);
  assert.equal(result.canEvaluateFrozenFreshness, true);
});

test('fails closed when endpoint, event, or timestamp field diverges from the qualified contract', () => {
  assert.equal(qualifyTwelveWsEventTimeSemantic({ endpoint: '/other' }).provenanceVerified, false);
  assert.equal(qualifyTwelveWsEventTimeSemantic({ eventType: 'quote' }).provenanceVerified, false);
  assert.equal(qualifyTwelveWsEventTimeSemantic({ timestampField: 'time' }).provenanceVerified, false);
});
