import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PAPER_MONITOR_REQUEST_TIMEOUT_MS, resolvePaperMonitorRequestTimeout } from '../learning/src/paperMonitorTimeout.js';

test('paper monitor timeout defaults conservatively below the 60-second cadence', () => {
  const timeout = resolvePaperMonitorRequestTimeout({ intervalMs: 60_000 });
  assert.equal(timeout.valid, true);
  assert.equal(timeout.timeoutMs, DEFAULT_PAPER_MONITOR_REQUEST_TIMEOUT_MS);
  assert.ok(timeout.timeoutMs < timeout.maximumMs);
});

test('paper monitor timeout accepts bounded overrides and fail-closes invalid values', () => {
  assert.deepEqual(resolvePaperMonitorRequestTimeout({ value: '45_000', intervalMs: 60_000 }), {
    valid: false, status: 'MONITOR_TIMEOUT_CONFIG_INVALID', timeoutMs: null, maximumMs: 59_000
  });
  assert.equal(resolvePaperMonitorRequestTimeout({ value: '45000', intervalMs: 60_000 }).timeoutMs, 45_000);
  for (const value of ['0', '-1', 'Infinity', '59000', '60000', 'not-a-number']) {
    const timeout = resolvePaperMonitorRequestTimeout({ value, intervalMs: 60_000 });
    assert.equal(timeout.valid, false, value);
    assert.equal(timeout.status, 'MONITOR_TIMEOUT_CONFIG_INVALID');
  }
});

