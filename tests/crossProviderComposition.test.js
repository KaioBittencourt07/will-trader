import assert from 'node:assert/strict';
import test from 'node:test';
import { composeSaxoClosedOhlcIndependentQuote, CROSS_PROVIDER_COMPOSITION_VERSION } from '../data/src/crossProviderComposition.js';
import { transformSaxoChartsOffline } from '../data/src/providers/saxoQualification.js';
import { createMultiProviderOhlc } from '../data/src/multiProviderOhlc.js';

const NOW = Date.parse('2026-09-09T12:00:20.000Z');
function saxo(overrides = {}) {
  const value = transformSaxoChartsOffline({ chartResponse: { ChartInfo: { Horizon: 1, FirstSampleTime: '2020-01-01T00:00:00Z' }, DataVersion: 1,
    Data: [{ Time: '2026-09-09T11:59:00.000Z', Open: 1.17, High: 1.171, Low: 1.169, Close: 1.1705 }] },
    sampleEvidence: 'SUBSCRIPTION_INITIAL_SNAPSHOT', receivedAt: '2026-09-09T12:00:19.000Z' });
  return { ...value, ...overrides };
}
function quote(overrides = {}, tickOverrides = {}) {
  return { mode: 'SHADOW_OBSERVABILITY', connected: true, subscriptionsAccepted: 1, subscriptionsRejected: 0,
    symbols: [{ symbol: 'EUR/USD', price: 1.1706, eventTimestamp: NOW - 5_000, receivedAt: new Date(NOW - 1_000).toISOString(), ...tickOverrides }], ...overrides };
}
const compose = (s = saxo(), q = quote(), options = {}) => composeSaxoClosedOhlcIndependentQuote({ saxoSnapshot: s, quoteHealth: q, now: NOW, ...options });

test('happy path composes offline with independent provider roles only', () => {
  const value = compose();
  assert.equal(value.compositionVersion, CROSS_PROVIDER_COMPOSITION_VERSION);
  assert.equal(value.compositionState, 'COMPOSABLE_OFFLINE');
  assert.equal(value.status, 'OFFLINE_QUALIFIED');
  assert.equal(value.valid, false);
  assert.equal(value.providers.quote.role, 'QUOTE_FRESHNESS_ONLY');
  assert.equal(value.providers.ohlc.role, 'OHLC_CLOSED_ONLY');
  assert.equal(value.prospectivePaperAuthorized, false);
});

test('stale and missing native quote timestamps fail closed', () => {
  assert.ok(compose(saxo(), quote({}, { eventTimestamp: NOW - 30_001 })).reasonCodes.includes('QUOTE_STALE'));
  assert.ok(compose(saxo(), quote({}, { eventTimestamp: null })).reasonCodes.includes('QUOTE_TIMESTAMP_INVALID'));
});

test('providerReceivedAt cannot rejuvenate a stale quote event', () => {
  const value = compose(saxo(), quote({}, { eventTimestamp: NOW - 40_000, receivedAt: new Date(NOW).toISOString() }));
  assert.equal(value.quoteAgeMs, 40_000);
  assert.ok(value.reasonCodes.includes('QUOTE_STALE'));
});

test('ambiguous Saxo sample evidence fails closed even with fresh quote', () => {
  const value = compose(saxo({ candleCompleteness: 'UNVERIFIED_BY_PROVIDER_PAYLOAD', completenessRule: null }), quote());
  assert.ok(value.reasonCodes.includes('SAXO_CLOSED_CANDLE_UNVERIFIED'));
});

test('canonical symbol and timeframe mismatch fail closed independently', () => {
  assert.ok(compose(saxo(), quote(), { canonicalSymbol: 'GBP/USD' }).reasonCodes.includes('CANONICAL_SYMBOL_UNSUPPORTED'));
  assert.ok(compose(saxo(), quote(), { timeframe: '5min' }).reasonCodes.includes('TIMEFRAME_MISMATCH'));
  assert.ok(compose(saxo(), quote({}, { symbol: 'GBP/USD' })).reasonCodes.includes('QUOTE_SYMBOL_MISMATCH'));
});

test('provider source separation and provenance are explicit', () => {
  const value = compose();
  assert.equal(value.quoteTimestamp, new Date(NOW - 5_000).toISOString());
  assert.equal(value.latestClosedCandleTimestamp, '2026-09-09T11:59:00.000Z');
  assert.equal(value.timestampOrigins.quoteTimestamp, 'twelvedata.websocket.price.timestamp');
  assert.equal(value.timestampOrigins.latestClosedCandleTimestamp, 'saxo.chart.v3.response.Data[].Time');
  assert.deepEqual(value.separation, { quoteProviderDeclaresCandleClosed: false, ohlcProviderDeclaresQuoteFresh: false,
    mixedOhlc: false, timestampSubstitution: false, championBypass: false });
});

test('freshness gate remains exactly 30 seconds', () => {
  assert.equal(compose().freshnessMaxAgeMs, 30_000);
  assert.ok(compose(saxo(), quote(), { maxAgeMs: 30_001 }).reasonCodes.includes('FRESHNESS_GATE_FROZEN'));
  assert.equal(compose(saxo(), quote({}, { eventTimestamp: NOW - 30_000 })).compositionState, 'COMPOSABLE_OFFLINE');
});

test('candle or receive timestamps cannot substitute for missing quote timestamp', () => {
  const value = compose(saxo({ providerReceivedAt: new Date(NOW).toISOString() }), quote({}, { eventTimestamp: null, receivedAt: new Date(NOW).toISOString() }));
  assert.equal(value.quoteTimestamp, null);
  assert.ok(value.reasonCodes.includes('QUOTE_TIMESTAMP_INVALID'));
});

test('OHLC remains exclusively Saxo and quote payload cannot mix bars', () => {
  const bars = saxo().candles;
  const value = compose(saxo(), quote({ candles: [{ open: 9, high: 9, low: 9, close: 9 }] }));
  assert.deepEqual(value.candles, bars);
  assert.equal(value.separation.mixedOhlc, false);
});

test('missing source provenance and malformed OHLC fail closed', () => {
  assert.ok(compose(saxo({ timestampOrigins: null }), quote()).reasonCodes.includes('SAXO_PROVENANCE_INSUFFICIENT'));
  assert.ok(compose(saxo({ candles: [{ close: 1 }] }), quote()).reasonCodes.includes('SAXO_OHLC_INVALID'));
});

test('offline qualification cannot bypass multi-provider decision gate', async () => {
  const snapshot = compose();
  const multi = createMultiProviderOhlc({ providers: [{ id: 'cross-provider-offline', symbols: { 'EUR/USD': 'EUR/USD' }, engine: {
    getProviderReadiness: () => ({ state: 'READY' }), getSnapshot: async () => snapshot
  } }] });
  await assert.rejects(() => multi.getSnapshot('EUR/USD'), (error) => error.code === 'ALL_PROVIDERS_UNAVAILABLE');
});
