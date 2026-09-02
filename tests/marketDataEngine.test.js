import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarketDataEngine } from '../data/src/marketDataEngine.js';

test('returns the cached snapshot without another upstream request', async () => {
  let calls = 0;
  const engine = createMarketDataEngine({
    provider: { getSnapshot: async () => ({ price: ++calls }) },
    cacheTtlMs: 1_000,
    minRequestIntervalMs: 0
  });

  const first = await engine.getSnapshot('EUR/USD');
  const second = await engine.getSnapshot('EUR/USD');
  assert.equal(first.price, 1);
  assert.equal(second.price, 1);
  assert.equal(calls, 1);
  assert.equal(engine.getMetrics().cacheHits, 1);
});

test('deduplicates concurrent requests for the same market key', async () => {
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const engine = createMarketDataEngine({
    provider: { getSnapshot: async () => { calls += 1; await pending; return { price: 1.2 }; } },
    minRequestIntervalMs: 0
  });

  const first = engine.getSnapshot('EUR/USD', '1min', 50);
  const second = engine.getSnapshot('EUR/USD', '1min', 50);
  release();
  assert.deepEqual(await first, await second);
  assert.equal(calls, 1);
  assert.equal(engine.getMetrics().deduplicated, 1);
});

test('spaces different cache misses using the request limiter', async () => {
  let time = 0;
  const waits = [];
  const engine = createMarketDataEngine({
    provider: { getSnapshot: async (asset) => ({ asset }) },
    now: () => time,
    wait: async (ms) => { waits.push(ms); time += ms; },
    minRequestIntervalMs: 500
  });

  await engine.getSnapshot('EUR/USD');
  await engine.getSnapshot('GBP/USD');
  assert.deepEqual(waits, [500]);
  assert.equal(engine.getMetrics().upstreamRequests, 2);
});

test('uses the provider batch capability and caches each returned asset', async () => {
  let batches = 0;
  const engine = createMarketDataEngine({
    provider: { getSnapshot: async () => null, getSnapshots: async (assets) => { batches += 1; return assets.map((asset) => ({ asset, snapshot: { asset, valid: true }, error: null })); } },
    now: () => 1
  });
  const first = await engine.getSnapshots(['EUR/USD', 'BTC/USD'], '1min', 50);
  const second = await engine.getSnapshots(['EUR/USD', 'BTC/USD'], '1min', 50);
  assert.equal(first.length, 2);
  assert.equal(second[1].snapshot.asset, 'BTC/USD');
  assert.equal(batches, 1);
});

test('records provider errors, 429s and upstream latency without turning them into data', async () => {
  let time = 10;
  const engine = createMarketDataEngine({
    provider: { getSnapshot: async () => { time += 17; throw new Error('Twelve Data HTTP 429'); } },
    now: () => time,
    minRequestIntervalMs: 0,
    maxRetries: 0
  });
  await assert.rejects(() => engine.getSnapshot('EUR/USD'), /429/);
  const metrics = engine.getMetrics();
  assert.equal(metrics.providerErrors, 1);
  assert.equal(metrics.provider429, 1);
  assert.equal(metrics.upstreamLatencySamples, 1);
  assert.equal(metrics.upstreamLatencyMsAverage, 17);
});

test('honors Retry-After and recovers provider state only after a real success', async () => {
  let calls = 0;
  const waits = [];
  const engine = createMarketDataEngine({
    provider: { getSnapshot: async () => { calls += 1; if (calls === 1) { const error = new Error('HTTP 429'); error.status = 429; error.retryAfterMs = 700; throw error; } return { price: 1 }; } },
    minRequestIntervalMs: 0,
    wait: async (ms) => waits.push(ms)
  });
  assert.deepEqual(await engine.getSnapshot('EUR/USD'), { price: 1 });
  assert.deepEqual(waits, [700]);
  assert.equal(engine.getMetrics().retries, 1);
  assert.equal(engine.getMetrics().providerState, 'HEALTHY');
});

test('bounds exponential backoff and exposes retry exhaustion without synthetic data', async () => {
  const waits = [];
  const engine = createMarketDataEngine({
    provider: { getSnapshot: async () => { throw new Error('network timeout'); } },
    minRequestIntervalMs: 0,
    maxRetries: 1,
    retryBaseMs: 100,
    retryMaxMs: 120,
    random: () => 1,
    wait: async (ms) => waits.push(ms)
  });
  await assert.rejects(() => engine.getSnapshot('EUR/USD'), /timeout/);
  assert.deepEqual(waits, [120]);
  assert.equal(engine.getMetrics().retryExhausted, 1);
  assert.equal(engine.getMetrics().providerState, 'DEGRADED');
});
