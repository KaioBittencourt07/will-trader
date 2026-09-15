import assert from 'node:assert/strict';
import test from 'node:test';
import { detectDrift } from '../learning/src/driftDetection.js';

const record = (minute, direction) => ({ createdAt: `2026-01-01T00:${String(minute).padStart(2, '0')}:00Z`, direction });

test('drift sorts evidence by time, exposes its version and does not mutate inputs', () => {
  const ordered = [...Array.from({ length: 5 }, (_, i) => record(i, 'BUY')), ...Array.from({ length: 5 }, (_, i) => record(i + 5, 'WAIT'))];
  const reverse = [...ordered].reverse();
  const result = detectDrift(reverse);
  assert.equal(result.status, 'DRIFT');
  assert.equal(result.driftVersion, 'drift-shadow-v1');
  assert.equal(result.window.baselineEnd, ordered[4].createdAt);
  assert.deepEqual(reverse, [...ordered].reverse());
});

test('missing timestamps remain insufficient shadow evidence with no Champion output', () => {
  const result = detectDrift(Array.from({ length: 10 }, () => ({ direction: 'WAIT' })));
  assert.equal(result.status, 'INSUFFICIENT_DATA');
  assert.equal(result.mode, 'SHADOW');
  assert.equal('direction' in result, false);
});
