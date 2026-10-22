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
  assert.equal(engine.getMetrics().rateLimitWaitMsTotal, 500);
  assert.equal(engine.getMetrics().rateLimitWaitCount, 1);
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

test('honors Retry-After as fail-closed cooldown without an immediate retry', async () => {
  let calls = 0;
  let time = 1_000;
  const engine = createMarketDataEngine({
    provider: { getSnapshot: async () => { calls += 1; if (calls === 1) { const error = new Error('HTTP 429'); error.status = 429; error.retryAfterMs = 700; throw error; } return { price: 1 }; } },
    minRequestIntervalMs: 0, now: () => time
  });
  await assert.rejects(() => engine.getSnapshot('EUR/USD'), /429/);
  assert.equal(calls, 1);
  assert.equal(engine.getMetrics().retries, 0);
  assert.equal(engine.getProviderReadiness().cooldownRemainingMs, 700);
  time += 700;
  assert.deepEqual(await engine.getSnapshot('EUR/USD'), { price: 1 });
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


test('diagnostic request shape warms the opportunity batch cache without a second provider slot', async () => {
  let singleCalls = 0;
  let batchCalls = 0;
  const engine = createMarketDataEngine({
    provider: {
      getSnapshot: async (asset) => { singleCalls += 1; return { asset, valid: true }; },
      getSnapshots: async () => { batchCalls += 1; throw new Error('batch should be cached'); }
    },
    minRequestIntervalMs: 60_000
  });
  await engine.getSnapshot('EUR/USD', '1min', 50);
  const results = await engine.getSnapshots(['EUR/USD'], '1min', 50);
  assert.equal(results[0].snapshot.valid, true);
  assert.equal(singleCalls, 1);
  assert.equal(batchCalls, 0);
  assert.equal(engine.getMetrics().rateLimitWaitCount, 0);
});

test('concurrent diagnostic and one-symbol scanner requests coalesce before provider access', async () => {
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const engine = createMarketDataEngine({
    provider: {
      getSnapshot: async (asset) => { calls += 1; await pending; return { asset, valid: true }; },
      getSnapshots: async () => { throw new Error('one-symbol batch must share getSnapshot'); }
    },
    minRequestIntervalMs: 0
  });
  const diagnostic = engine.getSnapshot('EUR/USD', '1min', 50);
  const scanner = engine.getSnapshots(['EUR/USD'], '1min', 50);
  release();
  assert.equal((await diagnostic).valid, true);
  assert.equal((await scanner)[0].snapshot.valid, true);
  assert.equal(calls, 1);
  assert.equal(engine.getMetrics().deduplicated, 1);
});

test('serializes concurrent misses for different assets instead of releasing a request burst', async () => {
  const starts = [];
  const engine = createMarketDataEngine({
    provider: {
      getSnapshot: async (asset) => {
        starts.push({ asset, at: Date.now() });
        return { asset, valid: true };
      }
    },
    cacheTtlMs: 0,
    minRequestIntervalMs: 45
  });

  await Promise.all([
    engine.getSnapshot('EUR/USD'),
    engine.getSnapshot('GBP/USD'),
    engine.getSnapshot('BTC/USD')
  ]);

  assert.equal(starts.length, 3);
  const gaps = starts.slice(1).map((item, index) => item.at - starts[index].at);
  assert.ok(gaps.every((gap) => gap >= 35), `upstream requests were too close together: ${gaps.join(',')}ms`);
  assert.equal(engine.getMetrics().upstreamRequests, 3);
});

test('each transient retry obtains a new rate-limited provider slot', async () => {
  let time = 0;
  let calls = 0;
  const starts = [];
  const waits = [];
  const engine = createMarketDataEngine({
    provider: {
      getSnapshot: async (asset) => {
        starts.push(time);
        calls++;
        if (calls === 1) {
          const error = new Error('HTTP 503 transient');
          error.status = 503;
          throw error;
        }
        return { asset, valid: true };
      }
    },
    now: () => time,
    wait: async (ms) => { waits.push(ms); time += ms; },
    minRequestIntervalMs: 100,
    maxRetries: 1,
    retryBaseMs: 5,
    retryMaxMs: 5,
    random: () => 0.5
  });

  const result = await engine.getSnapshot('EUR/USD');
  assert.equal(result.valid, true);
  assert.deepEqual(starts, [0, 100]);
  assert.deepEqual(waits, [5, 95]);
  assert.equal(engine.getMetrics().upstreamRequests, 2);
  assert.equal(engine.getMetrics().retries, 1);
});

test('coalesces a single-symbol diagnostic into an active multi-symbol batch', async () => {
  let singleCalls = 0;
  let batchCalls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const engine = createMarketDataEngine({
    provider: {
      getSnapshot: async (asset) => { singleCalls++; return { asset, valid: true, source: 'single' }; },
      getSnapshots: async (assets) => {
        batchCalls++;
        await pending;
        return assets.map((asset) => ({ asset, snapshot: { asset, valid: true, source: 'batch' }, error: null }));
      }
    },
    minRequestIntervalMs: 0
  });

  const batch = engine.getSnapshots(['EUR/USD', 'GBP/USD'], '1min', 50);
  const diagnostic = engine.getSnapshot('EUR/USD', '1min', 50);
  release();
  const [batchResult, diagnosticResult] = await Promise.all([batch, diagnostic]);

  assert.equal(batchCalls, 1);
  assert.equal(singleCalls, 0);
  assert.equal(batchResult.find((entry) => entry.asset === 'EUR/USD').snapshot.source, 'batch');
  assert.equal(diagnosticResult.source, 'batch');
  assert.equal(engine.getMetrics().deduplicated, 1);
});

test('credits-aware batching respects per-minute provider credit budget', async () => {
  let time = 0;
  const starts = [];
  const waits = [];
  const provider = {
    providerId: 'twelvedata',
    estimateCreditsForAssets: (assets) => assets.length * 2,
    estimateHttpRequestsForAssets: () => 2,
    maxSymbolsForCredits: (credits) => Math.floor(credits / 2),
    getSnapshot: async (asset) => ({ asset, valid: true }),
    getSnapshots: async (assets) => {
      starts.push({ assets: [...assets], at: time });
      return assets.map((asset) => ({ asset, snapshot: { asset, valid: true }, error: null }));
    }
  };
  const engine = createMarketDataEngine({
    provider,
    cacheTtlMs: 0,
    minRequestIntervalMs: 0,
    creditBudgetPerMinute: 6,
    now: () => time,
    wait: async (ms) => { waits.push(ms); time += ms; }
  });

  const result = await engine.getSnapshots(['EUR/USD', 'GBP/USD', 'BTC/USD', 'USD/JPY'], '1min', 50);
  assert.equal(result.length, 4);
  assert.deepEqual(starts.map((call) => call.assets.length), [3, 1]);
  assert.deepEqual(starts.map((call) => call.at), [0, 60_000]);
  assert.deepEqual(waits, [60_000]);
  assert.equal(engine.getMetrics().estimatedCreditsReserved, 8);
  assert.equal(engine.getMetrics().estimatedHttpRequests, 4);
  assert.equal(engine.getMetrics().creditBudgetPerMinute, 6);
  assert.equal(engine.getMetrics().creditBudgetWaitCount, 1);
  assert.equal(engine.getMetrics().estimatedCreditsInCurrentWindow, 2);
});

test('refuses a provider operation whose estimated credit cost cannot fit the configured budget', async () => {
  let calls = 0;
  const provider = {
    providerId: 'twelvedata',
    estimateCreditsForAssets: (assets) => assets.length * 2,
    estimateHttpRequestsForAssets: () => 2,
    maxSymbolsForCredits: (credits) => Math.floor(credits / 2),
    getSnapshot: async (asset) => { calls++; return { asset, valid: true }; },
    getSnapshots: async (assets) => { calls++; return assets.map((asset) => ({ asset, snapshot: { asset, valid: true }, error: null })); }
  };
  const engine = createMarketDataEngine({
    provider,
    creditBudgetPerMinute: 1,
    minRequestIntervalMs: 0
  });
  await assert.rejects(() => engine.getSnapshot('EUR/USD'), /PROVIDER_BATCH_CREDITS_EXCEED_MINUTE_BUDGET/);
  assert.equal(calls, 0);
});

test('daily quota exhaustion fails fast instead of keeping the caller waiting 24 hours', async () => {
  let time = 0;
  const starts = [];
  const waits = [];
  const provider = {
    providerId: 'twelvedata',
    estimateCreditsForAssets: (assets) => assets.length * 2,
    estimateHttpRequestsForAssets: () => 2,
    maxSymbolsForCredits: (credits) => Math.floor(credits / 2),
    getSnapshot: async (asset) => ({ asset, valid: true }),
    getSnapshots: async (assets) => {
      starts.push({ assets: [...assets], at: time });
      return assets.map((asset) => ({ asset, snapshot: { asset, valid: true }, error: null }));
    }
  };
  const engine = createMarketDataEngine({
    provider,
    cacheTtlMs: 0,
    minRequestIntervalMs: 0,
    creditBudgetPerMinute: 8,
    creditBudgetPerDay: 4,
    now: () => time,
    wait: async (ms) => { waits.push(ms); time += ms; }
  });

  await engine.getSnapshots(['EUR/USD', 'GBP/USD'], '1min', 50);
  await assert.rejects(
    () => engine.getSnapshots(['BTC/USD', 'USD/JPY'], '1min', 50),
    /PROVIDER_DAILY_CREDIT_BUDGET_EXHAUSTED/
  );

  assert.deepEqual(starts.map((call) => call.at), [0]);
  assert.deepEqual(waits, []);
  assert.equal(engine.getMetrics().creditBudgetPerMinute, 8);
  assert.equal(engine.getMetrics().creditBudgetPerDay, 4);
  assert.equal(engine.getMetrics().estimatedCreditsReserved, 4);
  assert.equal(engine.getMetrics().estimatedCreditsInCurrentDay, 4);
  assert.equal(engine.getMetrics().creditBudgetWaitCount, 0);
});

test('daily quota can wait briefly when enough previously reserved credits expire soon', async () => {
  let time = 0;
  const starts = [];
  const waits = [];
  const provider = {
    providerId: 'twelvedata',
    estimateCreditsForAssets: (assets) => assets.length * 2,
    estimateHttpRequestsForAssets: () => 2,
    maxSymbolsForCredits: (credits) => Math.floor(credits / 2),
    getSnapshot: async (asset) => ({ asset, valid: true }),
    getSnapshots: async (assets) => {
      starts.push({ assets: [...assets], at: time });
      return assets.map((asset) => ({ asset, snapshot: { asset, valid: true }, error: null }));
    }
  };
  const engine = createMarketDataEngine({
    provider,
    cacheTtlMs: 0,
    minRequestIntervalMs: 0,
    creditBudgetPerMinute: 8,
    creditBudgetPerDay: 4,
    maxDailyCreditWaitMs: 10_000,
    now: () => time,
    wait: async (ms) => { waits.push(ms); time += ms; }
  });

  await engine.getSnapshots(['EUR/USD', 'GBP/USD'], '1min', 50);
  time = 86_395_000;
  await engine.getSnapshots(['BTC/USD', 'USD/JPY'], '1min', 50);

  assert.deepEqual(starts.map((call) => call.at), [0, 86_400_000]);
  assert.deepEqual(waits, [5_000]);
  assert.equal(engine.getMetrics().estimatedCreditsReserved, 8);
  assert.equal(engine.getMetrics().estimatedCreditsInCurrentDay, 4);
});



test('supports zero-credit public market providers without consuming billed-provider quota', async () => {
  let calls = 0;
  const engine = createMarketDataEngine({
    provider: {
      providerId: 'coinbase-exchange-rest',
      estimateCreditsForAssets: () => 0,
      estimateHttpRequestsForAssets: () => 2,
      getSnapshot: async (asset) => { calls++; return { asset, price: 101, valid: true, status: 'OK' }; }
    },
    minRequestIntervalMs: 0,
    creditBudgetPerMinute: 1,
    creditBudgetPerDay: 1
  });
  const snapshot = await engine.getSnapshot('BTC/USD');
  assert.equal(snapshot.price, 101);
  assert.equal(calls, 1);
  assert.equal(engine.getMetrics().estimatedCreditsReserved, 0);
});
