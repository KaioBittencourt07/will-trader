import assert from 'node:assert/strict';
import test from 'node:test';
import { planMarketSourceRouting } from '../backend/src/marketSourceRouting.js';

test('routes mapped public crypto products without converting USD and USDT quote currencies', () => {
  const plan = planMarketSourceRouting(['btc/usd', 'BTC/USDT', 'EUR/USD', 'btc/usd']);
  assert.deepEqual(plan.normalized, ['BTC/USD', 'BTC/USDT', 'EUR/USD']);
  assert.deepEqual(plan.publicAssets, ['BTC/USD', 'BTC/USDT']);
  assert.deepEqual(plan.directTwelveAssets, ['EUR/USD']);
  assert.deepEqual(plan.forcedTwelveDataAssets, []);
});

test('forces Twelve Data when its OHLC provenance is required for a cross-provider composite', () => {
  const plan = planMarketSourceRouting(
    ['BTC/USD', 'ETH/USD', 'BTC/USDT', 'EUR/USD'],
    { forceTwelveDataAssets: ['BTC/USD', 'BTC/USD', 'eur/usd'] }
  );
  assert.deepEqual(plan.publicAssets, ['ETH/USD', 'BTC/USDT']);
  assert.deepEqual(plan.directTwelveAssets, ['BTC/USD', 'EUR/USD']);
  assert.deepEqual(plan.forcedTwelveDataAssets, ['BTC/USD', 'EUR/USD']);
});

test('ignores forced assets outside the bounded scan request and never infers unknown mappings', () => {
  const plan = planMarketSourceRouting(['AAPL', 'UNKNOWN/PAIR'], { forceTwelveDataAssets: ['BTC/USD'] });
  assert.deepEqual(plan.normalized, ['AAPL', 'UNKNOWN/PAIR']);
  assert.deepEqual(plan.publicAssets, []);
  assert.deepEqual(plan.directTwelveAssets, ['AAPL', 'UNKNOWN/PAIR']);
  assert.deepEqual(plan.forcedTwelveDataAssets, []);
});
