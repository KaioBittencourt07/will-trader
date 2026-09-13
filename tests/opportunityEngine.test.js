import assert from 'node:assert/strict';
import test from 'node:test';
import { selectBestOpportunity } from '../engine/src/opportunityEngine.js';

test('selects the highest-quality executable opportunity only', () => {
  const result = selectBestOpportunity([
    { asset: 'EUR/USD', decision: { direction: 'BUY', executable: true, blocked: false, confidence: 74, score: 80 } },
    { asset: 'GBP/USD', decision: { direction: 'SELL', executable: true, blocked: false, confidence: 82, score: 78 } },
    { asset: 'USD/JPY', decision: { direction: 'BUY', executable: false, blocked: true, confidence: 95, score: 95 } }
  ]);
  assert.equal(result.recommendation.asset, 'GBP/USD');
});

test('never recommends a blocked or WAIT decision', () => {
  const result = selectBestOpportunity([{ asset: 'EUR/USD', decision: { direction: 'WAIT', executable: false, blocked: true } }]);
  assert.equal(result.recommendation, null);
  assert.match(result.reason, /WAIT/);
});

test('uses confirmations and fresh market data to break close candidates without changing entry rules', () => {
  const result = selectBestOpportunity([
    { asset: 'EUR/USD', snapshot: { confirmations: 3, ageMs: 25_000 }, decision: { direction: 'BUY', executable: true, blocked: false, confidence: 80, score: 80, confirmations: 3, regimeConfidence: 80, setupConfidence: 80 } },
    { asset: 'AUD/USD', snapshot: { confirmations: 4, ageMs: 500 }, decision: { direction: 'SELL', executable: true, blocked: false, confidence: 80, score: 80, confirmations: 4, regimeConfidence: 80, setupConfidence: 80 } }
  ]);
  assert.equal(result.recommendation.asset, 'AUD/USD');
  assert.equal(result.recommendation.ranking.confirmations, 4);
  assert.ok(result.recommendation.ranking.quality > 0);
});
