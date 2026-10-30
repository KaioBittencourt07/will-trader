import assert from 'node:assert/strict';
import test from 'node:test';
import { createMultiProviderOhlc, MULTI_PROVIDER_OHLC_VERSION } from '../data/src/multiProviderOhlc.js';

const QUOTE = '2026-09-09T12:00:00.000Z';
const CANDLE = '2026-09-09T11:59:00.000Z';
const candles = [{ open: '1.1', high: '1.2', low: '1.0', close: '1.15' }];

function snapshot(asset, overrides = {}) {
  return {
    asset, timeframe: '1min', valid: true, status: 'OK', price: 1.15,
    quoteTimestamp: QUOTE, latestCandleTimestamp: CANDLE, candles,
    freshnessPolicyVersion: 'rest-quote-freshness-v1',
    timestampOrigins: { quoteTimestamp: 'provider.quote', candleTimestamp: 'provider.candle' },
    ...overrides
  };
}

function engine(result, readiness = { state: 'READY' }) {
  let calls = 0;
  return {
    getSnapshot: async (...args) => { calls += 1; return typeof result === 'function' ? result(...args) : result; },
    getProviderReadiness: () => readiness,
    calls: () => calls
  };
}

function layer(primary, fallback) {
  return createMultiProviderOhlc({ providers: [
    { id: 'primary', engine: primary, symbols: { 'EUR/USD': 'EUR/USD' } },
    { id: 'fallback', engine: fallback, symbols: { 'EUR/USD': 'EURUSD' } }
  ] });
}

test('selects a healthy primary with explicit provenance', async () => {
  const primary = engine(snapshot('EUR/USD'));
  const fallback = engine(snapshot('EURUSD'));
  const value = await layer(primary, fallback).getSnapshot('eur/usd');
  assert.equal(value.providerSelection.version, MULTI_PROVIDER_OHLC_VERSION);
  assert.equal(value.providerSelection.selectedProvider, 'primary');
  assert.equal(value.providerSelection.fallbackUsed, false);
  assert.equal(value.providerSelection.mergedAcrossProviders, false);
  assert.equal(fallback.calls(), 0);
});

test('primary 429 uses independently valid fallback without retrying primary', async () => {
  const primary = engine(() => { const error = new Error('HTTP 429'); error.status = 429; throw error; });
  const value = await layer(primary, engine(snapshot('EURUSD'))).getSnapshot('EUR/USD');
  assert.equal(value.providerSelection.selectedProvider, 'fallback');
  assert.equal(value.providerSelection.fallbackReason, 'RATE_LIMITED');
  assert.equal(primary.calls(), 1);
});

test('primary unavailable uses healthy fallback', async () => {
  const primary = engine(() => { throw new Error('network unreachable'); });
  const value = await layer(primary, engine(snapshot('EURUSD'))).getSnapshot('EUR/USD');
  assert.equal(value.providerSelection.selectedProvider, 'fallback');
  assert.equal(value.providerSelection.attempts[0].state, 'UNAVAILABLE');
});

test('all providers bad blocks with explicit selection evidence', async () => {
  const multi = layer(engine(null), engine(null));
  await assert.rejects(() => multi.getSnapshot('EUR/USD'), (error) => {
    assert.equal(error.code, 'ALL_PROVIDERS_UNAVAILABLE');
    assert.equal(error.providerSelection.selectedProvider, null);
    assert.equal(error.providerSelection.attempts.length, 2);
    return true;
  });
});

test('stale fallback cannot bypass the data-quality gate', async () => {
  const multi = layer(engine(null), engine(snapshot('EURUSD', { valid: false, status: 'STALE', reason: 'STALE_MARKET_DATA' })));
  await assert.rejects(() => multi.getSnapshot('EUR/USD'), (error) => {
    assert.ok(error.providerSelection.attempts[1].reasonCodes.includes('DATA_QUALITY_GATE_REJECTED'));
    return true;
  });
});

test('symbol and timeframe mismatch fail closed', async () => {
  await assert.rejects(() => layer(engine(snapshot('GBP/USD')), engine(null)).getSnapshot('EUR/USD'), (error) => {
    assert.ok(error.providerSelection.attempts[0].reasonCodes.includes('SYMBOL_MISMATCH'));
    return true;
  });
  await assert.rejects(() => layer(engine(snapshot('EUR/USD', { timeframe: '5min' })), engine(null)).getSnapshot('EUR/USD'), (error) => {
    assert.ok(error.providerSelection.attempts[0].reasonCodes.includes('TIMEFRAME_MISMATCH'));
    return true;
  });
});

test('malformed OHLC and insufficient provenance fail closed', async () => {
  await assert.rejects(() => layer(engine(snapshot('EUR/USD', { candles: [{ close: 1 }] })), engine(null)).getSnapshot('EUR/USD'), (error) => {
    assert.ok(error.providerSelection.attempts[0].reasonCodes.includes('OHLC_MALFORMED'));
    return true;
  });
  await assert.rejects(() => layer(engine(snapshot('EUR/USD', { timestampOrigins: null })), engine(null)).getSnapshot('EUR/USD'), (error) => {
    assert.ok(error.providerSelection.attempts[0].reasonCodes.includes('PROVENANCE_INSUFFICIENT'));
    return true;
  });
});

test('fallback preserves its own timestamps, candles and provider symbol without merging', async () => {
  const fallbackCandles = [{ open: 2, high: 3, low: 1, close: 2.5 }];
  const value = await layer(engine(null), engine(snapshot('EURUSD', { price: 2.5, quoteTimestamp: '2026-09-09T12:01:00.000Z', candles: fallbackCandles }))).getSnapshot('EUR/USD');
  assert.equal(value.asset, 'EUR/USD');
  assert.equal(value.providerAsset, 'EURUSD');
  assert.equal(value.quoteTimestamp, '2026-09-09T12:01:00.000Z');
  assert.equal(value.candles, fallbackCandles);
  assert.equal(value.providerSelection.provenancePreserved, true);
});

test('compatible concurrent requests deduplicate while provider engines remain isolated', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const primary = engine(async () => { await pending; return snapshot('EUR/USD'); });
  const fallback = engine(snapshot('EURUSD'));
  const multi = layer(primary, fallback);
  const telemetry = {};
  const first = multi.getSnapshot('EUR/USD');
  const second = multi.getSnapshot('EUR/USD', '1min', 50, { telemetry });
  release();
  assert.deepEqual(await first, await second);
  assert.equal(primary.calls(), 1);
  assert.equal(fallback.calls(), 0);
  assert.equal(telemetry.deduplicated, 1);
});

test('cooldown skips primary locally and status inspection consumes no provider', async () => {
  const primary = engine(snapshot('EUR/USD'), { state: 'COOLDOWN', cooldownRemainingMs: 5_000 });
  const fallback = engine(snapshot('EURUSD'));
  const multi = layer(primary, fallback);
  const status = multi.getStatus();
  assert.equal(status.inspectConsumesProvider, false);
  assert.equal(primary.calls(), 0);
  const value = await multi.getSnapshot('EUR/USD');
  assert.equal(value.providerSelection.selectedProvider, 'fallback');
  assert.equal(value.providerSelection.attempts[0].state, 'COOLDOWN');
  assert.equal(primary.calls(), 0);
});

test('missing canonical symbol mapping is explicit and never inferred', async () => {
  const primary = engine(snapshot('EUR/USD'));
  const multi = createMultiProviderOhlc({ providers: [{ id: 'primary', engine: primary, symbols: {} }] });
  await assert.rejects(() => multi.getSnapshot('EUR/USD'), (error) => {
    assert.ok(error.providerSelection.attempts[0].reasonCodes.includes('SYMBOL_MAPPING_MISSING'));
    assert.equal(primary.calls(), 0);
    return true;
  });
});
