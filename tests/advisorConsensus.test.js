import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAdvisorConsensus } from '../backend/src/consensus.js';

const deterministic = { direction: 'BUY', executable: true, blocked: false, confidence: 80, score: 82, blockReasons: [] };

test('advisor consensus approves only unanimous, confident confirmation', () => {
  const result = resolveAdvisorConsensus(deterministic, [{ source: 'Grok', direction: 'BUY', confidence: 80, block: false }, { source: 'Claude', direction: 'BUY', confidence: 76, block: false }]);
  assert.equal(result.approved, true);
  assert.equal(result.decision.direction, 'BUY');
});

test('advisor disagreement blocks the trade', () => {
  const result = resolveAdvisorConsensus(deterministic, [{ source: 'Claude', direction: 'SELL', confidence: 90, block: false }]);
  assert.equal(result.approved, false);
  assert.equal(result.decision.direction, 'WAIT');
});
