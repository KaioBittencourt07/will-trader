import assert from 'node:assert/strict';
import { decide } from '../engine/src/index.js';

const now = new Date().toISOString();

const valid = {
  asset: 'EUR/USD',
  timestamp: now,
  price: 1.17,
  timeframe: '1m',
  trend: 0.8,
  momentum: 0.7,
  structure: 0.8,
  volatility: 0.4,
  confirmations: 6
};

const bullish = decide(valid);
assert.equal(bullish.direction, 'BUY');
assert.equal(bullish.blocked, false);
assert.ok(bullish.score >= 70);

const stale = decide({ ...valid, timestamp: new Date(Date.now() - 180_000).toISOString() });
assert.equal(stale.direction, 'WAIT');
assert.equal(stale.blocked, true);
assert.match(stale.reason, /DATA GUARD/);

const extreme = decide({ ...valid, volatility: 0.95 });
assert.equal(extreme.direction, 'WAIT');
assert.equal(extreme.blocked, true);

const weak = decide({ ...valid, trend: 0.02, momentum: 0.01, structure: 0.03, confirmations: 1 });
assert.equal(weak.direction, 'WAIT');
assert.equal(weak.blocked, true);

console.log('WILL ENGINE tests: OK');
