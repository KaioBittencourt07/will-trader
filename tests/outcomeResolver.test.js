import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveProspectiveOutcome } from '../learning/src/outcomeResolver.js';

const record = { status: 'OPEN', direction: 'BUY', entryPrice: 100, signalTimestamp: '2026-09-02T12:00:00.000Z', metadata: { context: { expirySeconds: 60 } } };

test('paper resolver does not settle before expiry', () => {
  const outcome = resolveProspectiveOutcome(record, { price: 101 }, Date.parse('2026-09-02T12:00:30.000Z'));
  assert.equal(outcome.resolved, false);
});

test('paper resolver settles BUY, SELL and flat price prospectively', () => {
  assert.equal(resolveProspectiveOutcome(record, { price: 101 }, Date.parse('2026-09-02T12:01:00.000Z')).outcome, 'WIN');
  assert.equal(resolveProspectiveOutcome({ ...record, direction: 'SELL' }, { price: 101 }, Date.parse('2026-09-02T12:01:00.000Z')).outcome, 'LOSS');
  assert.equal(resolveProspectiveOutcome(record, { price: 100 }, Date.parse('2026-09-02T12:01:00.000Z')).outcome, 'VOID');
});
