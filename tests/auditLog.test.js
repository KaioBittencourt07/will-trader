import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuditEntry, closeAuditEntry } from '../engine/src/auditLog.js';

test('WAIT never receives a click time', () => {
  const entry = createAuditEntry({ decision: { direction: 'WAIT', blocked: true, confidence: 0 } });
  assert.equal(entry.clickTime, null);
  assert.equal(entry.blocked, true);
});

test('BUY decision preserves operational audit fields', () => {
  const entry = createAuditEntry({ signal: { asset: 'TEST' }, decision: { direction: 'BUY', confidence: 82, setup: 'BREAKOUT' } });
  assert.equal(entry.asset, 'TEST');
  assert.equal(entry.direction, 'BUY');
  assert.equal(entry.confidence, 82);
  assert.equal(entry.setup, 'BREAKOUT');
});

test('audit entry records final outcome', () => {
  const entry = createAuditEntry({ decision: { direction: 'SELL' } });
  const closed = closeAuditEntry(entry, 'LOSS', { result: -1 });
  assert.equal(closed.outcome, 'LOSS');
  assert.equal(closed.result, -1);
  assert.ok(closed.closedAt);
});
