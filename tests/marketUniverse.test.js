import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarketUniverseScheduler, MARKET_UNIVERSES } from '../data/src/marketUniverse.js';

test('all-market scheduler rotates through forex, crypto and stocks with a bounded request', () => {
  const scheduler = createMarketUniverseScheduler();
  const first = scheduler.take({ assetClass: 'ALL', limit: 4 });
  const second = scheduler.take({ assetClass: 'ALL', limit: 4 });
  assert.equal(first.totalAssets, MARKET_UNIVERSES.FOREX.length + MARKET_UNIVERSES.CRYPTO.length + MARKET_UNIVERSES.STOCKS.length);
  assert.equal(first.assets.length, 4);
  assert.equal(new Set([...first.assets, ...second.assets]).size, 8);
  assert.equal(first.assetClass, 'ALL');
});

test('asset-class scheduler rejects an unknown market class', () => {
  assert.throws(() => createMarketUniverseScheduler().take({ assetClass: 'OPTIONS' }), /Classe de ativo inválida/);
});

test('scheduler temporarily skips assets with unavailable market data', () => {
  let current = 0;
  const scheduler = createMarketUniverseScheduler({ universes: { FOREX: ['A', 'B'] }, now: () => current });
  scheduler.defer('A', 1_000);
  assert.deepEqual(scheduler.take({ assetClass: 'FOREX', limit: 1 }).assets, ['B']);
  current = 1_001;
  assert.deepEqual(scheduler.take({ assetClass: 'FOREX', limit: 1 }).assets, ['A']);
});

test('scheduler can prioritize a healthy forming setup without changing its universe', () => {
  const scheduler = createMarketUniverseScheduler({ universes: { FOREX: ['A', 'B', 'C'] } });
  scheduler.setPriority('C', 90);
  assert.deepEqual(scheduler.take({ assetClass: 'FOREX', limit: 1 }).assets, ['C']);
});


test('exposes separate, explicit watchlists for crypto quote currencies, ETFs, indices and commodities', () => {
  const scheduler = createMarketUniverseScheduler();
  for (const marketClass of ['CRYPTO_USDT', 'ETFS', 'INDICES', 'COMMODITIES']) {
    const result = scheduler.take({ assetClass: marketClass, limit: 4 });
    assert.equal(result.assetClass, marketClass);
    assert.ok(result.assets.length > 0);
    assert.ok(result.totalAssets >= result.assets.length);
  }
  assert.ok(MARKET_UNIVERSES.CRYPTO.includes('BTC/USD'));
  assert.ok(MARKET_UNIVERSES.CRYPTO_USDT.includes('BTC/USDT'));
  assert.notEqual(MARKET_UNIVERSES.CRYPTO[0], MARKET_UNIVERSES.CRYPTO_USDT[0]);
});
