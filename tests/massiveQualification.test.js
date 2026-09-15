import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyMassiveFailure, MASSIVE_QUALIFICATION, transformMassiveFxOffline } from '../data/src/providers/massiveQualification.js';
import { createMultiProviderOhlc } from '../data/src/multiProviderOhlc.js';

const NOW = '2026-09-09T12:00:20.000Z';
const ms = (value) => Date.parse(value);
function payload(overrides = {}) {
  return {
    aggregatesResponse: { ticker: 'C:EURUSD', results: [
      { t: ms('2026-09-09T11:58:00.000Z'), o: 1.1690, h: 1.1710, l: 1.1685, c: 1.1700 },
      { t: ms('2026-09-09T11:59:00.000Z'), o: 1.1700, h: 1.1710, l: 1.1690, c: 1.1705 }
    ] },
    lastQuoteResponse: { symbol: 'EUR/USD', last: { timestamp: ms('2026-09-09T12:00:10.000Z'), bid: 1.1704, ask: 1.1706 } },
    receivedAt: NOW,
    ...overrides
  };
}

test('uses explicit endpoint-specific EUR/USD mappings without aliases', () => {
  assert.equal(MASSIVE_QUALIFICATION.restAggregateTicker, 'C:EURUSD');
  assert.equal(MASSIVE_QUALIFICATION.restHistoricalQuoteTicker, 'C:EUR-USD');
  assert.equal(MASSIVE_QUALIFICATION.websocketSubscriptionTicker, 'EUR-USD');
  assert.throws(() => transformMassiveFxOffline(payload({ restAggregateTicker: 'C:EUR-USD' })), /SYMBOL_MAPPING_MISMATCH/);
  assert.throws(() => transformMassiveFxOffline(payload({ canonicalSymbol: 'EURUSD' })), /SYMBOL_MAPPING_MISMATCH/);
});

test('requires exact REST one-minute aggregate semantics', () => {
  assert.equal(transformMassiveFxOffline(payload()).timeframe, '1min');
  assert.throws(() => transformMassiveFxOffline(payload({ timespan: 'min' })), /TIMEFRAME_MAPPING_MISMATCH/);
  assert.throws(() => transformMassiveFxOffline(payload({ multiplier: 5 })), /TIMEFRAME_MAPPING_MISMATCH/);
});

test('validates numeric OHLC invariants and orders by provider window start', () => {
  const value = transformMassiveFxOffline(payload());
  assert.equal(value.candles[0].datetime, '2026-09-09T11:59:00.000Z');
  assert.equal(value.candles[1].datetime, '2026-09-09T11:58:00.000Z');
  const malformed = payload(); malformed.aggregatesResponse.results[0].h = null;
  assert.throws(() => transformMassiveFxOffline(malformed), /OHLC_MALFORMED/);
  const range = payload(); range.aggregatesResponse.results[0].c = 2;
  assert.throws(() => transformMassiveFxOffline(range), /OHLC_MALFORMED/);
});

test('quote at 30 seconds passes freshness but completeness still blocks', () => {
  const p = payload(); p.lastQuoteResponse.last.timestamp = ms('2026-09-09T11:59:50.000Z');
  const value = transformMassiveFxOffline(p);
  assert.equal(value.ageMs, 30_000);
  assert.equal(value.reason, 'CANDLE_COMPLETENESS_UNVERIFIED');
});

test('quote older than 30 seconds is stale under the frozen gate', () => {
  const p = payload(); p.lastQuoteResponse.last.timestamp = ms('2026-09-09T11:59:49.999Z');
  const value = transformMassiveFxOffline(p);
  assert.equal(value.status, 'STALE');
  assert.equal(value.ageMs, 30_001);
  assert.throws(() => transformMassiveFxOffline(payload({ maxAgeMs: 30_001 })), /FRESHNESS_GATE_FROZEN/);
});

test('future, invalid and missing provider timestamps fail closed', () => {
  const future = payload(); future.lastQuoteResponse.last.timestamp = ms('2026-09-09T12:01:21.000Z');
  assert.equal(transformMassiveFxOffline(future).reason, 'FUTURE_MARKET_DATA');
  const missingQuote = payload(); delete missingQuote.lastQuoteResponse.last.timestamp;
  assert.throws(() => transformMassiveFxOffline(missingQuote), /QUOTE_TIMESTAMP_MISSING/);
  const badBar = payload(); badBar.aggregatesResponse.results[0].t = 'bad';
  assert.throws(() => transformMassiveFxOffline(badBar), /OHLC_MALFORMED/);
});

test('preserves REST t and WebSocket s/e provenance without claiming finalization', () => {
  const value = transformMassiveFxOffline(payload({ websocketAggregate: {
    ev: 'CA', pair: 'EUR/USD', s: ms('2026-09-09T11:59:00.000Z'), e: ms('2026-09-09T11:59:59.999Z'),
    o: 1.17, h: 1.171, l: 1.169, c: 1.1705
  } }));
  assert.equal(value.websocketWindow.completeness, 'WINDOW_END_ONLY_NOT_FINALIZATION_PROOF');
  assert.equal(value.timestampOrigins.candleTimestamp, 'massive.rest.aggregates.results[].t[window_start_unix_ms]');
  assert.equal(value.timestampOrigins.websocketWindowEnd, 'massive.websocket.CA.e[unix_ms]');
  assert.equal(value.latestClosedCandleTimestamp, null);
});

test('window end or fixture finalized flags never fabricate VERIFIED_CLOSED', () => {
  const p = payload({ websocketAggregate: { ev: 'CA', pair: 'EUR/USD', s: ms('2026-09-09T11:59:00Z'), e: ms('2026-09-09T11:59:59.999Z'), finalized: true } });
  p.aggregatesResponse.results[1].complete = true;
  const value = transformMassiveFxOffline(p);
  assert.equal(value.candleCompleteness, 'UNVERIFIED_BY_PROVIDER_PAYLOAD');
  assert.equal(value.valid, false);
});

test('invalid WebSocket pair/window fails while WebSocket remains non-authoritative', () => {
  assert.throws(() => transformMassiveFxOffline(payload({ websocketAggregate: { ev: 'CA', pair: 'EUR-USD', s: 1, e: 2 } })), /WS_MAPPING_MISMATCH/);
  assert.throws(() => transformMassiveFxOffline(payload({ websocketAggregate: { ev: 'CA', pair: 'EUR/USD', s: 2, e: 1 } })), /WS_TIMESTAMP_INVALID/);
});

test('no quote and no-bar gaps are explicit failures, never synthetic data', () => {
  const noQuote = payload(); noQuote.lastQuoteResponse.last = null;
  assert.throws(() => transformMassiveFxOffline(noQuote), /QUOTE_TIMESTAMP_MISSING/);
  const noBar = payload(); noBar.aggregatesResponse.results = [];
  assert.throws(() => transformMassiveFxOffline(noBar), /OHLC_MISSING/);
});

test('401/403, 429 and availability errors use conservative classification', () => {
  assert.equal(classifyMassiveFailure({ status: 401 }), 'MISCONFIGURED');
  assert.equal(classifyMassiveFailure({ status: 403 }), 'MISCONFIGURED');
  assert.equal(classifyMassiveFailure({ status: 429 }), 'RATE_LIMITED');
  assert.equal(classifyMassiveFailure({ status: 503 }), 'UNAVAILABLE');
  assert.equal(classifyMassiveFailure(new Error('network timeout')), 'UNAVAILABLE');
});

test('receive time never rejuvenates quote and unverified bars fail multi-provider closed', async () => {
  const snapshot = transformMassiveFxOffline(payload());
  assert.equal(snapshot.quoteTimestamp, '2026-09-09T12:00:10.000Z');
  assert.equal(snapshot.providerReceivedAt, NOW);
  assert.notEqual(snapshot.quoteTimestamp, snapshot.providerReceivedAt);
  const multi = createMultiProviderOhlc({ providers: [{ id: 'massive-currencies', symbols: { 'EUR/USD': 'C:EURUSD' }, engine: {
    getProviderReadiness: () => ({ state: 'READY' }), getSnapshot: async () => snapshot
  } }] });
  await assert.rejects(() => multi.getSnapshot('EUR/USD'), (error) => error.code === 'ALL_PROVIDERS_UNAVAILABLE');
});

