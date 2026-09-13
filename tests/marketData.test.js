import assert from 'node:assert/strict';
import { createMarketSnapshot, validateSnapshot } from '../data/src/index.js';

const snapshot = createMarketSnapshot({
  asset: 'EUR/USD',
  timestamp: new Date().toISOString(),
  price: 1.17,
  timeframe: '1m',
  trend: 0.7,
  momentum: 0.6,
  structure: 0.8,
  volatility: 0.4,
  confirmations: 5,
  source: 'test'
});

assert.equal(validateSnapshot(snapshot).valid, true);
assert.equal(validateSnapshot({ ...snapshot, price: -1 }).valid, false);
assert.equal(validateSnapshot({ ...snapshot, timestamp: new Date(Date.now() - 180_000).toISOString() }).valid, false);
assert.equal(validateSnapshot({ ...snapshot, asset: null }).valid, false);

console.log('Market data tests: OK');
