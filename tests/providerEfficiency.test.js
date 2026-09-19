import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarketDataEngine } from '../data/src/marketDataEngine.js';
import { createProviderEfficiencyTelemetry } from '../data/src/providerEfficiency.js';
import { createTwelveDataProvider } from '../data/src/providers/twelveDataProvider.js';

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, headers: { get: () => null }, json: async () => body };
}

function candles(now, close = 1.17) {
  return Array.from({ length: 12 }, (_, index) => ({
    datetime: new Date(now - index * 60_000).toISOString(),
    open: String(close), high: String(close + 0.001), low: String(close - 0.001), close: String(close)
  }));
}

test('healthy observation reports two external HTTP requests once, then an equivalent cache hit', async () => {
  const now = Date.now();
  const provider = createTwelveDataProvider({
    apiKey: 'test', maxAgeMs: 120_000,
    fetchImpl: async (url) => String(url).includes('/quote?')
      ? response({ close: '1.17', timestamp: Math.floor(now / 1_000), is_market_open: true })
      : response({ values: candles(now) })
  });
  const engine = createMarketDataEngine({ provider, minRequestIntervalMs: 0, cacheTtlMs: 10_000 });
  const miss = createProviderEfficiencyTelemetry('first');
  const hit = createProviderEfficiencyTelemetry('second');
  const first = await engine.getSnapshot('EUR/USD', '1min', 50, { telemetry: miss });
  const second = await engine.getSnapshot('EUR/USD', '1min', 50, { telemetry: hit });

  assert.equal(second.price, first.price);
  assert.equal(second.timestamp, first.timestamp);
  assert.equal(second.valid, first.valid);
  assert.ok(second.ageMs >= first.ageMs);
  assert.deepEqual({ requests: miss.externalRequests, misses: miss.cacheMisses, credits: miss.creditsEstimated }, { requests: 2, misses: 1, credits: 2 });
  assert.deepEqual({ requests: hit.externalRequests, hits: hit.cacheHits, credits: hit.creditsEstimated }, { requests: 0, hits: 1, credits: 0 });
  assert.equal(hit.externalLatencyMs, 0);
  assert.equal(hit.creditsEstimatedIsOfficial, false);
});

test('batch accounting distinguishes two HTTP requests from per-symbol estimated credits', async () => {
  const now = Date.now();
  const quotes = { 'EUR/USD': { close: '1.17', timestamp: Math.floor(now / 1_000) }, 'GBP/USD': { close: '1.27', timestamp: Math.floor(now / 1_000) } };
  const series = { 'EUR/USD': { values: candles(now, 1.17) }, 'GBP/USD': { values: candles(now, 1.27) } };
  const provider = createTwelveDataProvider({ apiKey: 'test', maxAgeMs: 120_000, fetchImpl: async (url) => response(String(url).includes('/quote?') ? quotes : series) });
  const engine = createMarketDataEngine({ provider, minRequestIntervalMs: 0 });
  const telemetry = createProviderEfficiencyTelemetry('batch');
  const result = await engine.getSnapshots(['EUR/USD', 'GBP/USD'], '1min', 50, { telemetry });
  assert.equal(result.every((entry) => entry.snapshot?.valid), true);
  assert.deepEqual({ requests: telemetry.externalRequests, misses: telemetry.cacheMisses, credits: telemetry.creditsEstimated }, { requests: 2, misses: 2, credits: 4 });
});

test('429 accounting remains fail-closed and telemetry cannot manufacture a snapshot', async () => {
  const provider = createTwelveDataProvider({ apiKey: 'test', fetchImpl: async () => response({}, { ok: false, status: 429 }) });
  const engine = createMarketDataEngine({ provider, minRequestIntervalMs: 0, maxRetries: 0 });
  const telemetry = createProviderEfficiencyTelemetry('rate-limited');
  await assert.rejects(() => engine.getSnapshot('EUR/USD', '1min', 50, { telemetry }), /429/);
  assert.equal(telemetry.externalRequests, 2);
  assert.equal(telemetry.creditsEstimated, 2);
  assert.equal(engine.getMetrics().providerState, 'RATE_LIMITED');
});

test('malformed or absent telemetry is observational and never changes provider output', async () => {
  const snapshot = Object.freeze({ asset: 'EUR/USD', valid: true, price: 1.17, timestamp: '2026-09-03T12:00:00.000Z' });
  const engine = createMarketDataEngine({ provider: { getSnapshot: async () => snapshot }, minRequestIntervalMs: 0 });
  assert.equal(await engine.getSnapshot('EUR/USD', '1min', 50, { telemetry: null }), snapshot);
  assert.equal(await engine.getSnapshot('EUR/USD', '1min', 50, { telemetry: 'invalid' }), snapshot);
});
