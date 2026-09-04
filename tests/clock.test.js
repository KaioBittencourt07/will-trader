import assert from 'node:assert/strict';
import test from 'node:test';
import { createExecutionClock } from '../engine/src/clock.js';

test('clock provides deterministic current time and age', () => {
  const clock = createExecutionClock({ now: () => Date.parse('2026-08-26T12:00:02.000Z') });
  assert.equal(clock.nowIso(), '2026-08-26T12:00:02.000Z');
  assert.equal(clock.ageMs('2026-08-26T12:00:00.000Z'), 2000);
});
