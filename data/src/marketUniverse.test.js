import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKET_UNIVERSES, WILL_PHASE1_FX_CRYPTO, createMarketUniverseScheduler } from './marketUniverse.js';

test('official WILL universe contains every configured forex pair and only BTC ETH SOL crypto', () => {
  assert.deepEqual(WILL_PHASE1_FX_CRYPTO, [
    ...MARKET_UNIVERSES.FOREX,
    'BTC/USD', 'ETH/USD', 'SOL/USD'
  ]);
  assert.equal(WILL_PHASE1_FX_CRYPTO.length, 15);
  assert.equal(WILL_PHASE1_FX_CRYPTO.includes('XRP/USD'), false);
  assert.equal(WILL_PHASE1_FX_CRYPTO.some((asset) => MARKET_UNIVERSES.STOCKS.includes(asset)), false);
});

test('FX_CRYPTO scheduler rotates all 15 official assets in bounded batches', () => {
  const scheduler = createMarketUniverseScheduler();
  const observed = new Set();
  for (let i = 0; i < 10 && observed.size < WILL_PHASE1_FX_CRYPTO.length; i += 1) {
    const batch = scheduler.take({ assetClass: 'FX_CRYPTO', limit: 4 });
    for (const asset of batch.assets) observed.add(asset);
    assert.ok(batch.assets.length <= 4);
    assert.equal(batch.totalAssets, 15);
  }
  assert.deepEqual([...observed].sort(), [...WILL_PHASE1_FX_CRYPTO].sort());
});
