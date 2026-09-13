import test from 'node:test';
import assert from 'node:assert/strict';
import { composeWsFreshnessRestOhlc, WS_REST_COMPOSITION_VERSION } from '../data/src/wsRestComposition.js';

const NOW = Date.parse('2026-09-03T12:00:00.000Z');

function rest(overrides = {}) {
  return {
    asset: 'EUR/USD', timeframe: '1min', source: 'twelvedata', price: 1.1,
    valid: true, status: 'OK', reason: null,
    quoteTimestamp: new Date(NOW - 5_000).toISOString(), quoteAgeMs: 5_000, freshnessMaxAgeMs: 30_000,
    latestCandleTimestamp: new Date(NOW - 60_000).toISOString(), candleAgeMs: 60_000,
    candleCompleteness: 'UNVERIFIED_BY_PROVIDER_PAYLOAD', candles: [{ close: 1.1 }],
    cacheAgeMs: 2_000, freshnessPolicyVersion: 'rest-quote-freshness-v1',
    timestampOrigins: { quoteTimestamp: 'quote.datetime', candleTimestamp: 'time_series.values[0].datetime' },
    ...overrides
  };
}

function ws(overrides = {}, symbolOverrides = {}) {
  return {
    mode: 'SHADOW_OBSERVABILITY', connected: true, subscriptionsAccepted: 1, subscriptionsRejected: 0,
    staleAfterMs: 30_000,
    symbols: [{ symbol: 'EUR/USD', price: 1.1002, eventTimestamp: NOW - 2_000, receivedAt: new Date(NOW - 1_000).toISOString(), ...symbolOverrides }],
    ...overrides
  };
}

const compose = (r = rest(), w = ws(), options = {}) => composeWsFreshnessRestOhlc({
  restSnapshot: r, wsHealth: w, canonicalSymbol: 'EUR/USD', timeframe: '1min', now: NOW, ...options
});

test('fresh REST OHLC and fresh WS are composable in versioned SHADOW contract', () => {
  const value = compose();
  assert.equal(value.compositionPolicyVersion, WS_REST_COMPOSITION_VERSION);
  assert.equal(value.compositionMode, 'SHADOW');
  assert.equal(value.decisionImpact, 'NONE');
  assert.equal(value.compositionState, 'COMPOSABLE');
  assert.equal(value.restQuoteFresh, true);
  assert.equal(value.wsQuoteFresh, true);
  assert.equal(value.restOhlcAvailable, true);
  assert.equal(value.restOhlcAdequacy, 'OBSERVATIONAL_UNVERIFIED');
});

test('stale REST quote plus fresh WS is observationally composable but cannot change authority', () => {
  const stale = rest({ valid: false, status: 'STALE_MARKET_DATA', reason: 'STALE_MARKET_DATA', quoteAgeMs: 30_500 });
  const value = compose(stale);
  assert.equal(value.compositionState, 'COMPOSABLE');
  assert.ok(value.reasonCodes.includes('REST_QUOTE_STALE_SHADOW_ONLY'));
  assert.deepEqual(value.authoritativeDecision, { valid: false, status: 'STALE_MARKET_DATA', reason: 'STALE_MARKET_DATA', freshnessPolicyVersion: 'rest-quote-freshness-v1' });
  assert.equal(value.composableDoesNotAuthorizeDecision, true);
  assert.equal(stale.price, 1.1);
});

test('stale REST and stale WS fail closed', () => {
  const value = compose(rest({ valid: false, status: 'STALE_MARKET_DATA', quoteAgeMs: 31_000 }), ws({}, { eventTimestamp: NOW - 31_001, receivedAt: new Date(NOW - 31_001).toISOString() }));
  assert.equal(value.compositionState, 'NOT_COMPOSABLE');
  assert.ok(value.reasonCodes.includes('WS_TICK_STALE'));
});

test('disconnected WS fails closed', () => assert.equal(compose(rest(), ws({ connected: false })).compositionState, 'NOT_COMPOSABLE'));

test('rejected subscription and missing tick fail closed', () => {
  const value = compose(rest(), ws({ subscriptionsAccepted: 0, subscriptionsRejected: 1, symbols: [] }));
  assert.equal(value.compositionState, 'NOT_COMPOSABLE');
  assert.ok(value.reasonCodes.includes('WS_SUBSCRIPTION_REJECTED'));
  assert.ok(value.reasonCodes.includes('WS_TICK_MISSING'));
});

test('symbol mismatch fails closed explicitly', () => {
  const value = compose(rest(), ws({}, { symbol: 'GBP/USD' }));
  assert.equal(value.compositionState, 'NOT_COMPOSABLE');
  assert.ok(value.reasonCodes.includes('WS_SYMBOL_MISMATCH'));
});

test('invalid and future WS timestamps fail closed', () => {
  assert.ok(compose(rest(), ws({}, { eventTimestamp: null })).reasonCodes.includes('WS_TIMESTAMP_INVALID'));
  assert.ok(compose(rest(), ws({}, { eventTimestamp: NOW + 1_001 })).reasonCodes.includes('WS_TIMESTAMP_FUTURE'));
});

test('missing or invalid OHLC fails closed', () => {
  const value = compose(rest({ candles: [], latestCandleTimestamp: 'invalid' }));
  assert.equal(value.compositionState, 'NOT_COMPOSABLE');
  assert.ok(value.reasonCodes.includes('REST_OHLC_UNAVAILABLE'));
});

test('required candle completeness fails closed when provider cannot verify closure', () => {
  const value = compose(rest(), ws(), { requireClosedCandle: true });
  assert.equal(value.compositionState, 'NOT_COMPOSABLE');
  assert.ok(value.reasonCodes.includes('CANDLE_COMPLETENESS_UNVERIFIED'));
});

test('cache provenance cannot rejuvenate provider timestamps', () => {
  const value = compose(rest({ quoteAgeMs: 31_000, cacheAgeMs: 1 }));
  assert.equal(value.rest.quoteAgeMs, 31_000);
  assert.equal(value.rest.cacheAgeMs, 1);
  assert.equal(value.restQuoteFresh, false);
});

test('price divergence has explicit units and never changes REST price', () => {
  const value = compose();
  assert.equal(value.rest.price, 1.1);
  assert.equal(value.ws.price, 1.1002);
  assert.ok(Math.abs(value.priceDivergence.signedAbsolute - 0.0002) < 1e-12);
  assert.ok(Math.abs(value.priceDivergence.basisPoints - (0.0002 / 1.1 * 10_000)) < 1e-9);
  assert.equal(value.priceDivergence.authoritativePriceChanged, false);
});

test('provider mismatch and insufficient provenance remain UNKNOWN', () => {
  assert.equal(compose(rest({ source: 'other' })).compositionState, 'UNKNOWN');
  assert.equal(compose(rest({ timestampOrigins: null })).compositionState, 'UNKNOWN');
});

test('composer consumes snapshots only and neither exposes secrets nor creates connections', () => {
  let factoryCalls = 0;
  const health = ws({ createConnection: () => { factoryCalls += 1; }, apiKey: 'must-not-leak' });
  const encoded = JSON.stringify(compose(rest(), health));
  assert.equal(factoryCalls, 0);
  assert.equal(encoded.includes('must-not-leak'), false);
  assert.equal(encoded.includes('apiKey'), false);
});

test('missing REST or WS evidence fails closed as UNKNOWN', () => {
  assert.equal(composeWsFreshnessRestOhlc({ restSnapshot: undefined, wsHealth: ws(), canonicalSymbol: 'EUR/USD', timeframe: '1min', now: NOW }).compositionState, 'UNKNOWN');
  assert.equal(composeWsFreshnessRestOhlc({ restSnapshot: rest(), wsHealth: undefined, canonicalSymbol: 'EUR/USD', timeframe: '1min', now: NOW }).compositionState, 'UNKNOWN');
});
