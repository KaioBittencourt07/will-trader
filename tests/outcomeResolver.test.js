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

test('resolver anchors expiry and entry price to the executed trade when available', () => {
  const executed = {
    ...record,
    entryPrice: 100,
    execution: { actualClickTime: '2026-09-02T12:02:00.000Z', actualEntryPrice: 101 }
  };
  const earlyReference = resolveProspectiveOutcome(executed, { price: 102, timestamp: '2026-09-02T12:02:30.000Z' }, Date.parse('2026-09-02T12:03:30.000Z'));
  assert.equal(earlyReference.resolved, false);
  assert.equal(earlyReference.reason, 'REFERENCE_BEFORE_EXPIRY');
  const outcome = resolveProspectiveOutcome(executed, { price: 102, timestamp: '2026-09-02T12:03:00.000Z' }, Date.parse('2026-09-02T12:03:01.000Z'));
  assert.equal(outcome.resolved, true);
  assert.equal(outcome.entryPrice, 101);
  assert.equal(outcome.outcome, 'WIN');
});

test('resolver records DATA_INVALID instead of inventing a settlement from bad data', () => {
  const invalid = resolveProspectiveOutcome(record, { price: null, timestamp: '2026-09-02T12:01:00.000Z', valid: false, status: 'STALE' }, Date.parse('2026-09-02T12:01:01.000Z'));
  assert.equal(invalid.resolved, true);
  assert.equal(invalid.outcome, 'DATA_INVALID');
  assert.equal(invalid.reason, 'RESOLUTION_DATA_STALE');
});
