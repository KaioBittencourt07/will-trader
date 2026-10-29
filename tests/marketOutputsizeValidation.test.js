import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMarketOutputsize } from '../backend/src/routes/market.js';

test('defaults missing market outputsize to 50', () => {
  assert.deepEqual(parseMarketOutputsize(undefined), { value: 50 });
});

test('clamps integer outputsize to route-specific bounds', () => {
  assert.deepEqual(parseMarketOutputsize('1', 12), { value: 12 });
  assert.deepEqual(parseMarketOutputsize('500', 20), { value: 200 });
  assert.deepEqual(parseMarketOutputsize('75', 12), { value: 75 });
});

test('rejects malformed outputsize instead of passing NaN to market providers', () => {
  for (const value of ['abc', '1.5', '-2', 'Infinity', '1e3', '9007199254740992']) {
    assert.deepEqual(parseMarketOutputsize(value), { error: 'MARKET_OUTPUTSIZE_INVALID' }, value);
  }
});

test('accepts zero as an integer and clamps it to the minimum', () => {
  assert.deepEqual(parseMarketOutputsize('0', 12), { value: 12 });
});
