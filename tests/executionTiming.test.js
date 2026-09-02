import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExecutionTiming, evaluateClickWindow } from '../engine/src/executionTiming.js';

const marketTime = '2026-08-26T12:00:00.000Z';
const signalTime = '2026-08-26T12:00:01.000Z';

test('builds a bounded click window and expiry', () => {
  const timing = buildExecutionTiming({ signalTime, marketTime, executionDelayMs: 500, expirySeconds: 60 });
  assert.equal(timing.valid, true);
  assert.equal(timing.clickTime, '2026-08-26T12:00:01.500Z');
  assert.equal(timing.expiryTime, '2026-08-26T12:01:01.500Z');
});

test('builds a one-to-five minute manual entry window around a suggested time', () => {
  const signalTime = '2026-08-26T12:00:00.000Z';
  const timing = buildExecutionTiming({ signalTime, marketTime: signalTime, executionDelayMs: 120_000, entryWindowStartMs: 60_000, entryWindowEndMs: 300_000, expirySeconds: 60 });
  assert.equal(timing.clickTime, '2026-08-26T12:02:00.000Z');
  assert.equal(timing.validFrom, '2026-08-26T12:01:00.000Z');
  assert.equal(timing.validUntil, '2026-08-26T12:05:00.000Z');
});

test('rejects clicks after the window', () => {
  const timing = buildExecutionTiming({ signalTime, marketTime });
  const state = evaluateClickWindow(timing, Date.parse('2026-08-26T12:00:04.001Z'));
  assert.equal(state.canClick, false);
  assert.equal(state.status, 'EXPIRED');
});

test('rejects invalid chronology', () => {
  const timing = buildExecutionTiming({ signalTime: marketTime, marketTime: signalTime });
  assert.equal(timing.valid, false);
  assert.equal(timing.status, 'INVALID');
});
