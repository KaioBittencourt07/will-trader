import test from 'node:test';
import assert from 'node:assert/strict';
import { createBiquoteForexRuntimeFeed } from './biquoteForexRuntimeFeed.js';

const SYMBOLS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'NZDUSD', 'USDCAD', 'GBPJPY'];
const BASE = Date.parse('2026-09-14T21:40:00.000Z');

function payload(timestamp = '2026-09-14T21:39:55.000Z') {
  return Object.fromEntries(SYMBOLS.map((symbol, index) => [symbol, {
    mid: 1 + index / 100,
    timestamp,
    source: 'MetaTrader 5 (Broker 1)',
    marketState: 'open',
    stale: false,
    quoteAgeSeconds: 5
  }]));
}

test('polls one cached Biquote batch and exposes all eight forex assets as ready', async () => {
  let calls = 0;
  const feed = createBiquoteForexRuntimeFeed({
    enabled: true,
    now: () => BASE,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => payload() };
    }
  });

  assert.equal(await feed.pollOnce(), true);
  assert.equal(calls, 1);
  const health = feed.health();
  assert.equal(health.successfulPolls, 1);
  assert.equal(Object.values(health.assets).every((asset) => asset.ready), true);
  assert.equal(feed.getAssetHealth('EUR/USD').temporalAuthority.authorityGate, 'PASS');
  assert.equal(feed.getAssetHealth('EUR/USD').temporalAuthority.freshnessGate, 'PASS');
  assert.equal(feed.getAssetHealth('EUR/USD').ordersExecuted, 0);

  const reference = feed.referenceAtOrAfter('EUR/USD', Date.parse('2026-09-14T21:39:50.000Z'));
  assert.equal(reference.price, 1);
  assert.equal(reference.timestamp, '2026-09-14T21:39:55.000Z');
  assert.equal(reference.lagMs, 5_000);
  assert.equal(health.assets['EUR/USD'].retainedOutcomeReferences, 1);
  assert.equal(feed.referenceAtOrAfter('EUR/USD', Date.parse('2026-09-14T21:39:50.000Z'), 60_000), null);
});

test('cached tick fails closed once event age crosses frozen 30s contract', async () => {
  let current = BASE;
  const feed = createBiquoteForexRuntimeFeed({
    enabled: true,
    now: () => current,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => payload() })
  });

  await feed.pollOnce();
  assert.equal(feed.getAssetHealth('EUR/USD').ready, true);
  current = BASE + 31_000;
  const stale = feed.getAssetHealth('EUR/USD');
  assert.equal(stale.ready, false);
  assert.equal(stale.temporalAuthority.freshnessGate, 'FAIL');
});

test('disabled runtime performs no provider request', async () => {
  let calls = 0;
  const feed = createBiquoteForexRuntimeFeed({
    enabled: false,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => payload() };
    }
  });
  assert.equal(feed.start(), false);
  assert.equal(await feed.pollOnce(), false);
  assert.equal(calls, 0);
  assert.equal(feed.health().state, 'DISABLED');
});
