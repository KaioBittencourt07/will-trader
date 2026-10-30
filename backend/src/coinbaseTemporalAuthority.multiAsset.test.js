import test from 'node:test';
import assert from 'node:assert/strict';
import { coinbaseProductFor } from './coinbaseTemporalAuthority.js';

test('maps authorized phase1 crypto symbols to Coinbase products', () => {
  assert.equal(coinbaseProductFor('BTC/USD'), 'BTC-USD');
  assert.equal(coinbaseProductFor('ETH/USD'), 'ETH-USD');
  assert.equal(coinbaseProductFor('SOL/USD'), 'SOL-USD');
  assert.equal(coinbaseProductFor('XRP/USD'), 'XRP-USD');
});

test('keeps unsupported Coinbase temporal symbols fail closed', () => {
  assert.throws(() => coinbaseProductFor('ADA/USD'), /COINBASE_TEMPORAL_SYMBOL_UNQUALIFIED/);
});
