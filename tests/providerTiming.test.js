import test from 'node:test';
import assert from 'node:assert/strict';
import { createTwelveDataProvider } from '../data/src/providers/twelveDataProvider.js';
import { createMarketDataEngine } from '../data/src/marketDataEngine.js';
import { refreshMarketSnapshotFreshness } from '../data/src/marketAdapter.js';

const BASE = Date.parse('2026-09-04T01:00:30.500Z');

function responses({ quoteTimestamp = BASE - 30_500, candleTimestamp = BASE - 90_500 } = {}) {
  const candles = Array.from({ length: 20 }, (_, index) => ({
    datetime: new Date(candleTimestamp - index * 60_000).toISOString(),
    open: '1.17', high: '1.171', low: '1.169', close: '1.17'
  }));
  return async (url) => ({
    ok: true,
    headers: { get: () => null },
    json: async () => url.includes('/quote?')
      ? { close: '1.17', timestamp: Math.floor(quoteTimestamp / 1_000), is_market_open: true }
      : { values: candles }
  });
}

test('reproduces 30.5s provider quote as stale without changing the 30s gate', async () => {
  const provider = createTwelveDataProvider({ apiKey: 'test', fetchImpl: responses(), now: () => BASE, maxAgeMs: 30_000 });
  const snapshot = await provider.getSnapshot('EUR/USD', '1min', 20);
  assert.equal(snapshot.valid, false);
  assert.equal(snapshot.status, 'STALE');
  assert.equal(snapshot.reason, 'STALE_MARKET_DATA');
  assert.equal(snapshot.ageMs, 30_500);
  assert.equal(snapshot.quoteAgeMs, 30_500);
  assert.equal(snapshot.freshnessBasis, 'REST_QUOTE_TIMESTAMP');
  assert.equal(snapshot.freshnessMaxAgeMs, 30_000);
});

test('separates quote, candle, receive and unmeasurable provider latency semantics', async () => {
  const provider = createTwelveDataProvider({ apiKey: 'test', fetchImpl: responses({ quoteTimestamp: BASE - 500 }), now: () => BASE });
  const snapshot = await provider.getSnapshot('EUR/USD', '1min', 20);
  assert.equal(snapshot.valid, true);
  assert.equal(snapshot.quoteAgeMs, 500);
  assert.equal(snapshot.candleAgeMs, 90_500);
  assert.equal(snapshot.latestClosedCandleTimestamp, null);
  assert.equal(snapshot.candleCompleteness, 'UNVERIFIED_BY_PROVIDER_PAYLOAD');
  assert.equal(snapshot.providerReceivedAt, '2026-09-04T01:00:30.500Z');
  assert.equal(snapshot.providerTiming.providerLatencyMs, null);
});

test('missing or invalid provider timestamp fails closed', async () => {
  const fetchImpl = async (url) => ({ ok: true, headers: { get: () => null }, json: async () => url.includes('/quote?')
    ? { close: '1.17', timestamp: 'invalid' }
    : { values: [{ datetime: '2026-09-04T01:00:00.000Z', open: '1', high: '2', low: '.5', close: '1' }] } });
  const provider = createTwelveDataProvider({ apiKey: 'test', fetchImpl, now: () => BASE });
  await assert.rejects(() => provider.getSnapshot('EUR/USD'), /timestamp válido/);
});

test('cache time never rejuvenates quote freshness across the gate', async () => {
  let now = BASE;
  const original = {
    valid: true, status: 'OK', asset: 'EUR/USD', timeframe: '1min', price: 1.17,
    timestamp: new Date(BASE - 29_000).toISOString(), quoteTimestamp: new Date(BASE - 29_000).toISOString(),
    candleTimestamp: new Date(BASE - 60_000).toISOString(), freshnessPolicyVersion: 'rest-quote-freshness-v1',
    freshnessBasis: 'REST_QUOTE_TIMESTAMP', freshnessMaxAgeMs: 30_000
  };
  const engine = createMarketDataEngine({ provider: { getSnapshot: async () => original }, now: () => now, cacheTtlMs: 10_000, minRequestIntervalMs: 0 });
  assert.equal((await engine.getSnapshot('EUR/USD')).valid, true);
  now += 2_000;
  const cached = await engine.getSnapshot('EUR/USD');
  assert.equal(cached.valid, false);
  assert.equal(cached.ageMs, 31_000);
  assert.equal(cached.cacheAgeMs, 2_000);
});

test('limiter or WS shadow freshness cannot rejuvenate a stale REST quote', () => {
  const stale = refreshMarketSnapshotFreshness({
    valid: true, status: 'OK', asset: 'EUR/USD', timeframe: '1min', price: 1.17,
    timestamp: new Date(BASE - 30_500).toISOString(), quoteTimestamp: new Date(BASE - 30_500).toISOString(),
    candleTimestamp: new Date(BASE - 60_000).toISOString(), freshnessPolicyVersion: 'rest-quote-freshness-v1',
    freshnessBasis: 'REST_QUOTE_TIMESTAMP', freshnessMaxAgeMs: 30_000,
    webSocketShadow: { available: true, lastTickAgeMs: 5 }
  }, { now: BASE, cacheStoredAt: BASE });
  assert.equal(stale.valid, false);
  assert.equal(stale.reason, 'STALE_MARKET_DATA');
  assert.equal(stale.freshnessBasis, 'REST_QUOTE_TIMESTAMP');
});
