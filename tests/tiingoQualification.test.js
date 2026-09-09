import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyTiingoFailure, TIINGO_QUALIFICATION, transformTiingoFxOffline } from '../data/src/providers/tiingoQualification.js';
import { createMultiProviderOhlc } from '../data/src/multiProviderOhlc.js';

const NOW = '2026-09-09T12:00:20.000Z';
function payload(overrides = {}) {
  return {
    topResponse: [{ ticker: 'EURUSD', quoteTimestamp: '2026-09-09T12:00:10.000Z', bidPrice: 1.1704, askPrice: 1.1706, midPrice: 1.1705 }],
    historicalResponse: [
      { ticker: 'EURUSD', date: '2026-09-09T11:58:00.000Z', open: 1.1690, high: 1.1710, low: 1.1685, close: 1.1700 },
      { ticker: 'EURUSD', date: '2026-09-09T11:59:00.000Z', open: 1.1700, high: 1.1710, low: 1.1690, close: 1.1705 }
    ],
    receivedAt: NOW,
    ...overrides
  };
}

test('maps EUR/USD to the explicitly documented Tiingo EURUSD ticker only', () => {
  const value = transformTiingoFxOffline(payload());
  assert.equal(value.asset, 'EURUSD');
  assert.equal(TIINGO_QUALIFICATION.providerTicker, 'EURUSD');
  assert.throws(() => transformTiingoFxOffline(payload({ canonicalSymbol: 'EURUSD' })), /SYMBOL_MAPPING_MISMATCH/);
  assert.throws(() => transformTiingoFxOffline(payload({ providerTicker: 'EUR_USD' })), /SYMBOL_MAPPING_MISMATCH/);
});

test('keeps 1min support explicitly unverified and rejects inferred timeframe aliases', () => {
  const value = transformTiingoFxOffline(payload());
  assert.equal(value.resampleFreq, '1min');
  assert.equal(value.resampleFreqSupport, 'UNVERIFIED_IN_OFFICIAL_DOCUMENTATION');
  assert.throws(() => transformTiingoFxOffline(payload({ resampleFreq: 'M1' })), /TIMEFRAME_MAPPING_MISMATCH/);
});

test('fresh quote still fails closed because candle completeness is not provider-verified', () => {
  const value = transformTiingoFxOffline(payload());
  assert.equal(value.status, 'INVALID');
  assert.equal(value.valid, false);
  assert.equal(value.reason, 'CANDLE_COMPLETENESS_UNVERIFIED');
  assert.equal(value.candleCompleteness, 'UNVERIFIED_BY_PROVIDER_PAYLOAD');
  assert.equal(value.latestClosedCandleTimestamp, null);
});

test('a quote older than the frozen 30-second gate remains stale', () => {
  const p = payload(); p.topResponse[0].quoteTimestamp = '2026-09-09T11:59:40.000Z';
  const value = transformTiingoFxOffline(p);
  assert.equal(value.status, 'STALE');
  assert.equal(value.reason, 'STALE_MARKET_DATA');
  assert.equal(value.quoteAgeMs, 40_000);
  assert.equal(value.freshnessMaxAgeMs, 30_000);
  assert.throws(() => transformTiingoFxOffline(payload({ maxAgeMs: 30_001 })), /FRESHNESS_GATE_FROZEN/);
});

test('preserves provider timestamps and sorts historical OHLC newest first', () => {
  const value = transformTiingoFxOffline(payload());
  assert.equal(value.quoteTimestamp, '2026-09-09T12:00:10.000Z');
  assert.equal(value.candles[0].datetime, '2026-09-09T11:59:00.000Z');
  assert.equal(value.providerReceivedAt, NOW);
  assert.notEqual(value.quoteTimestamp, value.providerReceivedAt);
  assert.equal(value.timestampOrigins.quoteTimestamp, 'tiingo.fx.top[].quoteTimestamp');
  assert.equal(value.timestampOrigins.candleTimestamp, 'tiingo.fx.prices[].date');
});

test('missing or malformed OHLC fails closed', () => {
  assert.throws(() => transformTiingoFxOffline(payload({ historicalResponse: [] })), /OHLC_MISSING/);
  const malformed = payload(); malformed.historicalResponse[0].high = null;
  assert.throws(() => transformTiingoFxOffline(malformed), /OHLC_MALFORMED/);
  const badRange = payload(); badRange.historicalResponse[0].close = 2;
  assert.throws(() => transformTiingoFxOffline(badRange), /OHLC_MALFORMED/);
});

test('quote identity, timestamp, book and documented midpoint semantics are validated', () => {
  const symbol = payload(); symbol.topResponse[0].ticker = 'GBPUSD';
  assert.throws(() => transformTiingoFxOffline(symbol), /RESPONSE_SYMBOL_MISMATCH/);
  const timestamp = payload(); delete timestamp.topResponse[0].quoteTimestamp;
  assert.throws(() => transformTiingoFxOffline(timestamp), /QUOTE_TIMESTAMP_MISSING/);
  const book = payload(); book.topResponse[0].bidPrice = 2;
  assert.throws(() => transformTiingoFxOffline(book), /QUOTE_MALFORMED/);
  const midpoint = payload(); midpoint.topResponse[0].midPrice = 1.2;
  assert.throws(() => transformTiingoFxOffline(midpoint), /MIDPRICE_INCONSISTENT/);
});

test('payload fields cannot fabricate candle completeness', () => {
  const p = payload(); p.historicalResponse[1].complete = true; p.historicalResponse[1].closed = true;
  const value = transformTiingoFxOffline(p);
  assert.equal(value.candleCompleteness, 'UNVERIFIED_BY_PROVIDER_PAYLOAD');
  assert.equal(value.valid, false);
});

test('auth and rate-limit failures have conservative multi-provider classifications', () => {
  assert.equal(classifyTiingoFailure({ status: 401 }), 'MISCONFIGURED');
  assert.equal(classifyTiingoFailure({ status: 403 }), 'MISCONFIGURED');
  assert.equal(classifyTiingoFailure({ status: 429 }), 'RATE_LIMITED');
  assert.equal(classifyTiingoFailure({ status: 503 }), 'UNAVAILABLE');
  assert.equal(classifyTiingoFailure(new Error('network timeout')), 'UNAVAILABLE');
});

test('unverified Tiingo candles cannot pass multi-provider-ohlc-resilience-v1', async () => {
  const snapshot = transformTiingoFxOffline(payload());
  const multi = createMultiProviderOhlc({ providers: [{
    id: 'tiingo-fx', symbols: { 'EUR/USD': 'EURUSD' },
    engine: { getProviderReadiness: () => ({ state: 'READY' }), getSnapshot: async () => snapshot }
  }] });
  await assert.rejects(() => multi.getSnapshot('EUR/USD'), (error) => {
    assert.equal(error.code, 'ALL_PROVIDERS_UNAVAILABLE');
    assert.ok(error.providerSelection.attempts[0].reasonCodes.includes('DATA_QUALITY_GATE_REJECTED'));
    return true;
  });
});

