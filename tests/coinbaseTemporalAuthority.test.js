import assert from 'node:assert/strict';
import test from 'node:test';
import { observationFromCoinbaseTicker, qualifyCoinbaseTickerSeries } from '../backend/src/coinbaseTemporalAuthority.js';

const BASE = Date.parse('2026-09-14T12:00:20.000Z');
const ticker = (offsetMs, price, sequence) => ({
  type: 'ticker',
  product_id: 'BTC-USD',
  price: String(price),
  sequence,
  trade_id: sequence,
  time: new Date(BASE + offsetMs).toISOString()
});

const obs = (offsetMs, price, sequence, receiveExtra = 250) => observationFromCoinbaseTicker({
  payload: ticker(offsetMs, price, sequence),
  receivedAt: new Date(BASE + offsetMs + receiveExtra).toISOString(),
  canonicalSymbol: 'BTC/USD'
});

test('extracts Coinbase ticker match time with explicit provenance but no self-approval', () => {
  const value = obs(-3_000, 76000, 100);
  assert.equal(value.provider, 'coinbase-exchange-ticker');
  assert.equal(value.symbol, 'BTC/USD');
  assert.equal(value.providerProduct, 'BTC-USD');
  assert.equal(value.timestampAuthority, 'COINBASE_EXCHANGE_TICKER_MATCH_TIME');
  assert.equal(value.provenanceVerified, true);
  assert.equal(value.perEventSemanticsVerified, false);
});

test('approves coherent per-match progression after enough observations', () => {
  const observations = [
    obs(-4_000, 76000, 100),
    obs(-3_000, 76001, 101),
    obs(-2_000, 76002, 102),
    obs(-1_000, 76003, 103)
  ];
  const result = qualifyCoinbaseTickerSeries({ observations, now: BASE });
  assert.equal(result.canEvaluateFrozenFreshness, true);
  assert.equal(result.observation.acceptedObservations, 4);
  assert.equal(result.observation.distinctEventTimestamps, 4);
  assert.equal(result.observation.timestampRegressions, 0);
  assert.equal(result.observation.sequenceRegressions, 0);
  assert.equal(result.temporalAuthority.authorityGate, 'PASS');
  assert.equal(result.temporalAuthority.freshnessGate, 'PASS');
});

test('fails closed on timestamp or sequence regression', () => {
  const timestampRegression = [
    obs(-4_000, 76000, 100),
    obs(-3_000, 76001, 101),
    obs(-3_500, 76002, 102),
    obs(-1_000, 76003, 103)
  ];
  assert.equal(qualifyCoinbaseTickerSeries({ observations: timestampRegression, now: BASE }).canEvaluateFrozenFreshness, false);

  const sequenceRegression = [
    obs(-4_000, 76000, 100),
    obs(-3_000, 76001, 101),
    obs(-2_000, 76002, 99),
    obs(-1_000, 76003, 103)
  ];
  const result = qualifyCoinbaseTickerSeries({ observations: sequenceRegression, now: BASE });
  assert.equal(result.canEvaluateFrozenFreshness, false);
  assert.ok(result.semanticReasonCodes.includes('COINBASE_TICKER_SEQUENCE_REGRESSION'));
});

test('fails closed when price changes share one timestamp or event/receive skew is excessive', () => {
  const sameTime = [
    obs(-1_000, 76000, 100),
    obs(-1_000, 76001, 101),
    obs(-1_000, 76002, 102),
    obs(-1_000, 76003, 103)
  ];
  const coarse = qualifyCoinbaseTickerSeries({ observations: sameTime, now: BASE });
  assert.equal(coarse.canEvaluateFrozenFreshness, false);
  assert.equal(coarse.observation.coarseTimestampObserved, true);

  const skewed = [
    obs(-20_000, 76000, 100, 20_000),
    obs(-19_000, 76001, 101, 20_000),
    obs(-18_000, 76002, 102, 20_000),
    obs(-17_000, 76003, 103, 20_000)
  ];
  const result = qualifyCoinbaseTickerSeries({ observations: skewed, now: BASE + 3_000 });
  assert.equal(result.canEvaluateFrozenFreshness, false);
  assert.ok(result.semanticReasonCodes.includes('COINBASE_TICKER_EVENT_RECEIVE_SKEW_TOO_LARGE'));
});

test('rejects malformed ticker messages', () => {
  assert.throws(() => observationFromCoinbaseTicker({ payload: { type: 'ticker', product_id: 'ETH-USD', price: '1', time: new Date(BASE).toISOString() }, receivedAt: new Date(BASE).toISOString() }), /SYMBOL_MISMATCH/);
  assert.throws(() => observationFromCoinbaseTicker({ payload: { type: 'ticker', product_id: 'BTC-USD', price: '0', time: new Date(BASE).toISOString() }, receivedAt: new Date(BASE).toISOString() }), /PRICE_INVALID/);
  assert.throws(() => observationFromCoinbaseTicker({ payload: { type: 'ticker', product_id: 'BTC-USD', price: '1' }, receivedAt: new Date(BASE).toISOString() }), /EVENT_TIME_MISSING/);
});
