import assert from 'node:assert/strict';
import test from 'node:test';
import { composeBiquoteTwelveOperationalSnapshot } from '../backend/src/biquoteTwelveOperationalSnapshot.js';

const EVENT = Date.parse('2026-09-14T21:41:20.250Z');

function candle(offsetMinutes, close = 1.155) {
  const openMs = Date.parse('2026-09-14T21:40:00.000Z') + offsetMinutes * 60_000;
  return {
    datetime: new Date(openMs).toISOString(),
    open: String(close - 0.0002),
    high: String(close + 0.0004),
    low: String(close - 0.0004),
    close: String(close)
  };
}

function twelveSnapshot() {
  const candles = [];
  for (let i = 1; i >= -60; i -= 1) candles.push(candle(i, 1.155 + i / 100000));
  return {
    asset: 'EUR/USD',
    timeframe: '1min',
    price: 1.155,
    timestamp: '2026-09-14T21:41:00.000Z',
    candles,
    source: 'twelvedata',
    featureVersion: 'candle-price-action-v2'
  };
}

function health(overrides = {}) {
  return {
    enabled: true,
    ready: true,
    latestTick: {
      symbol: 'EUR/USD',
      providerSymbol: 'EURUSD',
      price: 1.1552,
      eventTimestamp: EVENT,
      eventTimeRaw: '2026-09-14T21:41:20.250Z',
      receivedAt: '2026-09-14T21:41:20.300Z',
      source: 'MetaTrader 5 (Broker 1)',
      marketState: 'open',
      stale: false,
      quoteAgeSeconds: 1
    },
    temporalAuthority: {
      provider: 'biquote-forex',
      symbol: 'EUR/USD',
      timestampAuthority: 'BIQUOTE_API_LATEST_TICK_TIMESTAMP',
      provenanceVerified: true,
      perEventSemanticsVerified: true,
      authorityGate: 'PASS',
      freshnessGate: 'PASS',
      freshnessContractMs: 30_000,
      eventTimestamp: EVENT,
      receivedAt: '2026-09-14T21:41:20.300Z',
      eventAgeMs: 50,
      reasons: [],
      blocker: null,
      ordersExecuted: 0
    },
    ...overrides
  };
}

test('composes Biquote forex tick/time with only fully closed Twelve 1m candles', () => {
  const result = composeBiquoteTwelveOperationalSnapshot({
    twelveSnapshot: twelveSnapshot(),
    biquoteHealth: health(),
    now: EVENT + 100,
    requiredBars: 50
  });
  assert.equal(result.valid, true);
  assert.equal(result.asset, 'EUR/USD');
  assert.equal(result.price, 1.1552);
  assert.equal(result.compositeProvider, 'BIQUOTE');
  assert.equal(result.authoritativeFreshness.authorityGate, 'PASS');
  assert.equal(result.authoritativeFreshness.freshnessGate, 'PASS');
  assert.equal(result.candleCompleteness, 'VERIFIED_CLOSED_BY_BIQUOTE_EVENT_TIME');
  assert.equal(result.latestClosedCandleTimestamp, '2026-09-14T21:40:00.000Z');
  assert.ok(result.candleCount >= 50);
  assert.equal(result.candles.some((bar) => bar.datetime === '2026-09-14T21:41:00.000Z'), false);
  assert.equal(result.ordersExecuted, 0);
});

test('fails closed when Biquote runtime is not ready', () => {
  const result = composeBiquoteTwelveOperationalSnapshot({
    twelveSnapshot: twelveSnapshot(),
    biquoteHealth: health({ ready: false }),
    now: EVENT + 100
  });
  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes('BIQUOTE_TEMPORAL_RUNTIME_NOT_READY'));
});
