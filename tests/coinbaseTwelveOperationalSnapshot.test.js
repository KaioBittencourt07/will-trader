import assert from 'node:assert/strict';
import test from 'node:test';
import { composeCoinbaseTwelveOperationalSnapshot } from '../backend/src/coinbaseTwelveOperationalSnapshot.js';

const EVENT = Date.parse('2026-09-14T12:01:20.250Z');

function candle(offsetMinutes, close = 76000) {
  const openMs = Date.parse('2026-09-14T12:00:00.000Z') + offsetMinutes * 60_000;
  return {
    datetime: new Date(openMs).toISOString(),
    open: String(close - 5),
    high: String(close + 10),
    low: String(close - 10),
    close: String(close)
  };
}

function twelveSnapshot() {
  const candles = [];
  for (let i = 1; i >= -60; i -= 1) candles.push(candle(i, 76000 + i));
  return {
    asset: 'BTC/USD',
    timeframe: '1min',
    price: 76010,
    timestamp: '2026-09-14T12:01:00.000Z',
    candles,
    source: 'twelvedata',
    featureVersion: 'candle-price-action-v2'
  };
}

function health(overrides = {}) {
  return {
    ready: true,
    latestTick: {
      symbol: 'BTC/USD',
      price: 76020,
      eventTimestamp: EVENT,
      eventTimeRaw: '2026-09-14T12:01:20.250123Z',
      receivedAt: '2026-09-14T12:01:20.300Z'
    },
    temporalAuthority: {
      version: 'temporal-authority-provider-v1',
      provider: 'coinbase-exchange-ticker',
      source: 'coinbase-exchange-ticker',
      symbol: 'BTC/USD',
      timestampAuthority: 'COINBASE_EXCHANGE_TICKER_MATCH_TIME',
      provenanceVerified: true,
      perEventSemanticsVerified: true,
      comparableToReceiveClock: true,
      authorityGate: 'PASS',
      freshnessGate: 'PASS',
      freshnessContractMs: 30_000,
      eventTimestamp: EVENT,
      receivedAt: '2026-09-14T12:01:20.300Z',
      eventAgeMs: 50,
      receiveAgeMs: 0,
      clockSkewMs: 50,
      reasons: [],
      blocker: null,
      decisionImpact: 'ALLOW_ANALYSIS_ONLY',
      ordersExecuted: 0
    },
    ...overrides
  };
}

test('composes fresh Coinbase price/time with only fully closed Twelve 1m candles', () => {
  const result = composeCoinbaseTwelveOperationalSnapshot({
    twelveSnapshot: twelveSnapshot(),
    coinbaseHealth: health(),
    now: EVENT + 100,
    requiredBars: 50
  });
  assert.equal(result.valid, true);
  assert.equal(result.price, 76020);
  assert.equal(result.authoritativeFreshness.authorityGate, 'PASS');
  assert.equal(result.authoritativeFreshness.freshnessGate, 'PASS');
  assert.equal(result.candleCompleteness, 'VERIFIED_CLOSED_BY_DOCUMENTED_CHART_CONTEXT');
  assert.equal(result.latestClosedCandleTimestamp, '2026-09-14T12:00:00.000Z');
  assert.ok(result.candleCount >= 50);
  assert.equal(result.candles.some((bar) => bar.datetime === '2026-09-14T12:01:00.000Z'), false);
  assert.equal(result.featureVersion, 'candle-price-action-v2');
  assert.equal(result.ordersExecuted, 0);
});

test('fails closed when Coinbase temporal runtime is not ready', () => {
  const result = composeCoinbaseTwelveOperationalSnapshot({
    twelveSnapshot: twelveSnapshot(),
    coinbaseHealth: health({ ready: false }),
    now: EVENT + 100
  });
  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes('COINBASE_TEMPORAL_RUNTIME_NOT_READY'));
});

test('fails closed when fewer than required fully closed candles remain', () => {
  const raw = twelveSnapshot();
  raw.candles = raw.candles.slice(0, 20);
  const result = composeCoinbaseTwelveOperationalSnapshot({ twelveSnapshot: raw, coinbaseHealth: health(), now: EVENT + 100 });
  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes('TWELVE_CLOSED_BARS_INSUFFICIENT'));
});
