import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyOandaFailure, OANDA_QUALIFICATION, transformOandaOffline } from '../data/src/providers/oandaQualification.js';
import { createMultiProviderOhlc } from '../data/src/multiProviderOhlc.js';

const NOW = '2026-09-09T12:00:20.000Z';
function payload(overrides = {}) {
  return {
    candlesResponse: { instrument: 'EUR_USD', granularity: 'M1', candles: [{ time: '2026-09-09T11:59:00.000Z', complete: true, volume: 10, mid: { o: '1.1700', h: '1.1710', l: '1.1690', c: '1.1705' } }] },
    pricingResponse: { prices: [{ instrument: 'EUR_USD', time: '2026-09-09T12:00:10.000Z', closeoutBid: '1.1704', closeoutAsk: '1.1706' }] },
    receivedAt: NOW,
    ...overrides
  };
}

test('qualifies complete OANDA M1 midpoint evidence offline', () => {
  const value = transformOandaOffline(payload());
  assert.equal(value.valid, true);
  assert.equal(value.asset, 'EUR_USD');
  assert.equal(value.timeframe, '1min');
  assert.equal(value.candleCompleteness, 'VERIFIED_CLOSED');
  assert.equal(value.price, 1.1705);
  assert.equal(OANDA_QUALIFICATION.enabledByDefault, false);
  assert.equal(OANDA_QUALIFICATION.liveEligibility, 'EXTERNAL_UNVERIFIED');
});

test('incomplete-only candles fail closed', () => {
  const p = payload(); p.candlesResponse.candles[0].complete = false;
  assert.throws(() => transformOandaOffline(p), /OANDA_COMPLETE_CANDLE_MISSING/);
});

test('latest closed candle is selected by timestamp, never array position or incomplete data', () => {
  const p = payload();
  p.candlesResponse.candles = [
    { time: '2026-09-09T12:00:00.000Z', complete: false, mid: { o: '9', h: '9', l: '9', c: '9' } },
    p.candlesResponse.candles[0],
    { time: '2026-09-09T11:58:00.000Z', complete: true, mid: { o: '1', h: '2', l: '.5', c: '1' } }
  ];
  const value = transformOandaOffline(p);
  assert.equal(value.latestClosedCandleTimestamp, '2026-09-09T11:59:00.000Z');
  assert.equal(value.candles.length, 2);
});

test('stale pricing timestamp remains stale under frozen 30s gate', () => {
  const p = payload(); p.pricingResponse.prices[0].time = '2026-09-09T11:59:40.000Z';
  const value = transformOandaOffline(p);
  assert.equal(value.valid, false);
  assert.equal(value.reason, 'STALE_MARKET_DATA');
  assert.equal(value.quoteAgeMs, 40_000);
  assert.equal(value.freshnessMaxAgeMs, 30_000);
});

test('symbol and timeframe mappings and response identity are strict', () => {
  assert.throws(() => transformOandaOffline(payload({ canonicalSymbol: 'GBP/USD' })), /SYMBOL_MAPPING_MISMATCH/);
  assert.throws(() => transformOandaOffline(payload({ timeframe: '5min' })), /TIMEFRAME_MAPPING_MISMATCH/);
  const symbol = payload(); symbol.candlesResponse.instrument = 'GBP_USD';
  assert.throws(() => transformOandaOffline(symbol), /RESPONSE_SYMBOL_MISMATCH/);
  const frame = payload(); frame.candlesResponse.granularity = 'M5';
  assert.throws(() => transformOandaOffline(frame), /RESPONSE_TIMEFRAME_MISMATCH/);
});

test('malformed OHLC and missing timestamps fail closed', () => {
  const malformed = payload(); malformed.candlesResponse.candles[0].mid.h = 'bad';
  assert.throws(() => transformOandaOffline(malformed), /OANDA_OHLC_MALFORMED/);
  const quote = payload(); delete quote.pricingResponse.prices[0].time;
  assert.throws(() => transformOandaOffline(quote), /OANDA_QUOTE_TIMESTAMP_MISSING/);
  assert.throws(() => transformOandaOffline(payload({ receivedAt: null })), /OANDA_PROVIDER_RECEIVED_AT_MISSING/);
});

test('401/403 map to MISCONFIGURED, 429 to RATE_LIMITED, and 5xx/network to UNAVAILABLE', () => {
  for (const status of [401, 403]) assert.equal(classifyOandaFailure({ status }), 'MISCONFIGURED');
  assert.equal(classifyOandaFailure({ status: 429 }), 'RATE_LIMITED');
  assert.equal(classifyOandaFailure({ status: 503 }), 'UNAVAILABLE');
  assert.equal(classifyOandaFailure(new Error('network timeout')), 'UNAVAILABLE');
});

test('provenance and timestamps are preserved without rejuvenation', () => {
  const value = transformOandaOffline(payload());
  assert.equal(value.quoteTimestamp, '2026-09-09T12:00:10.000Z');
  assert.equal(value.latestClosedCandleTimestamp, '2026-09-09T11:59:00.000Z');
  assert.equal(value.providerReceivedAt, NOW);
  assert.equal(value.timestampOrigins.quoteTimestamp, 'oanda.pricing.prices[].time');
  assert.equal(value.quoteAgeMs, 10_000);
  assert.notEqual(value.quoteTimestamp, value.providerReceivedAt);
});

test('offline snapshot is compatible with frozen multi-provider gate', async () => {
  const oanda = transformOandaOffline(payload());
  const multi = createMultiProviderOhlc({ providers: [{ id: 'oanda-rest-v20', symbols: { 'EUR/USD': 'EUR_USD' }, engine: { getProviderReadiness: () => ({ state: 'READY' }), getSnapshot: async () => oanda } }] });
  const value = await multi.getSnapshot('EUR/USD');
  assert.equal(value.providerSelection.selectedProvider, 'oanda-rest-v20');
  assert.equal(value.providerSelection.provenancePreserved, true);
});

test('stale OANDA snapshot cannot bypass multi-provider data quality', async () => {
  const p = payload(); p.pricingResponse.prices[0].time = '2026-09-09T11:59:40.000Z';
  const stale = transformOandaOffline(p);
  const multi = createMultiProviderOhlc({ providers: [{ id: 'oanda', symbols: { 'EUR/USD': 'EUR_USD' }, engine: { getProviderReadiness: () => ({ state: 'READY' }), getSnapshot: async () => stale } }] });
  await assert.rejects(() => multi.getSnapshot('EUR/USD'), (error) => error.code === 'ALL_PROVIDERS_UNAVAILABLE');
});
