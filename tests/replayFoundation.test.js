import assert from 'node:assert/strict';
import test from 'node:test';
import { willCore } from '../engine/src/willCore.js';
import { replayEvidence, replayEvidenceBatch, REPLAY_CONTRACT_VERSION } from '../learning/src/replayFoundation.js';

function evidence() {
  const snapshot = { asset: 'EUR/USD', timeframe: '1min', timestamp: '2026-09-02T12:00:00.000Z', price: 1.2, valid: true, status: 'OK', source: 'test', trend: 0.8, momentum: 0.6, structure: 0.7, volatility: 0.3, confirmations: 4, candleCount: 50 };
  const decision = willCore(snapshot, { dataValid: true, expirySeconds: 60 });
  return { id: 'replay-1', strategyVersion: 'will-core-v1', modelVersion: 'deterministic-v1', asset: snapshot.asset, timeframe: snapshot.timeframe, signalTimestamp: snapshot.timestamp, entryPrice: snapshot.price, direction: decision.direction, score: decision.score, confidence: decision.confidence, regime: decision.regime, setup: decision.setup, confirmations: decision.confirmations, blocked: decision.blocked, metadata: { dataQuality: { valid: true, status: 'OK', source: 'test' }, featureSnapshot: { trend: 0.8, momentum: 0.6, structure: 0.7, volatility: 0.3, confirmations: 4, candleCount: 50 }, context: { dataValid: true, expirySeconds: 60 } } };
}

test('offline replay deterministically reproduces persisted evidence without external calls', () => {
  const result = replayEvidence(evidence());
  assert.equal(result.contractVersion, REPLAY_CONTRACT_VERSION);
  assert.equal(result.match, true);
  assert.deepEqual(result.reasons, []);
});

test('offline replay reports mismatch reason codes grouped by strategy version', () => {
  const changed = { ...evidence(), id: 'replay-2', confidence: 0 };
  const batch = replayEvidenceBatch([evidence(), changed]);
  assert.equal(batch.n, 2);
  assert.equal(batch.mismatches, 1);
  assert.equal(batch.byVersion[0].reasonCodes.REPLAY_CONFIDENCE_MISMATCH, 1);
});
