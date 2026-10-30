import assert from 'node:assert/strict';
import test from 'node:test';
import { systemHealth } from '../engine/src/health.js';

test('system is healthy only when every required component passes', () => {
  const healthy = systemHealth({ data: true, core: true, risk: true, macro: true, news: true, paper: true, memory: true, backtest: true, audit: true });
  assert.equal(healthy.healthy, true);
  assert.equal(healthy.healthyCount, healthy.total);
});

test('system reports failed component', () => {
  const result = systemHealth({ data: true, core: true, risk: false });
  assert.equal(result.healthy, false);
  assert.equal(result.checks.risk, false);
});
