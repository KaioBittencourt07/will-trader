import assert from 'node:assert/strict';
import test from 'node:test';
import { observationFromCoinbaseTicker, parseCoinbasePreciseTime, qualifyCoinbaseTickerSeries } from '../backend/src/coinbaseTemporalAuthority.js';

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

function preciseObs({ time, price, sequence, tradeId = sequence, receivedAt = '2026-09-14T12:00:20.300Z' }) {
  return observationFromCoinbaseTicker({
    payload: { type: 'ticker', product_id: 'BTC-USD', price: String(price), sequence, trade_id: tradeId, time },
    receivedAt,
    canonicalSymbol: 'BTC/USD'
  });
}

test('extracts Coinbase ticker match time with explicit provenance but no self-approval', () => {
  const value = obs(-3_000, 76000, 100);
  assert.equal(value.provider, 'coinbase-exchange-ticker');
  assert.equal(value.symbol, 'BTC/USD');
  assert.equal(value.providerProduct, 'BTC-USD');
  assert.equal(value.timestampAuthority, 'COINBASE_EXCHANGE_TICKER_MATCH_TIME');
  assert.equal(value.provenanceVerified, true);
  assert.equal(value.perEventSemanticsVerified, false);
});

test('preserves provider microsecond precision that Date.parse would truncate', () => {
  const a = parseCoinbasePreciseTime('2026-09-14T12:00:20.061123Z');
  const b = parseCoinbasePreciseTime('2026-09-14T12:00:20.061769Z');
  assert.equal(a.eventTimestamp, b.eventTimestamp);
  assert.notEqual(a.precisionKey, b.precisionKey);
  assert.ok(b.fractionNanoseconds > a.fractionNanoseconds);
  assert.equal(a.precisionDigits, 6);
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

test('sub-millisecond match progression is valid when provider precision and sequence both progress', () => {
  const times = [
    '2026-09-14T12:00:20.061123Z',
    '2026-09-14T12:00:20.061321Z',
    '2026-09-14T12:00:20.061554Z',
    '2026-09-14T12:00:20.061769Z'
  ];
  const observations = times.map((time, index) => preciseObs({
    time,
    price: 76000 + index,
    sequence: 200 + index,
    tradeId: 300 + index,
    receivedAt: '2026-09-14T12:00:20.200Z'
  }));
  const result = qualifyCoinbaseTickerSeries({ observations, now: BASE + 200 });
  assert.equal(result.canEvaluateFrozenFreshness, true);
  assert.equal(result.observation.distinctMillisecondTimestamps, 1);
  assert.equal(result.observation.distinctEventTimestamps, 4);
  assert.equal(result.observation.subMillisecondProgressions, 3);
  assert.equal(result.observation.coarseTimestampObserved, false);
  assert.ok(result.semanticReasonCodes.includes('COINBASE_SUB_MILLISECOND_EVENT_TIME_OBSERVED'));
});

test('allows equal exact event time when Coinbase event identity advances', () => {
  const observations = [
    preciseObs({ time: '2026-09-14T12:00:16.100000Z', price: 76000, sequence: 400, tradeId: 500, receivedAt: '2026-09-14T12:00:16.300Z' }),
    preciseObs({ time: '2026-09-14T12:00:17.200000Z', price: 76001, sequence: 401, tradeId: 501, receivedAt: '2026-09-14T12:00:17.300Z' }),
    preciseObs({ time: '2026-09-14T12:00:17.200000Z', price: 76002, sequence: 402, tradeId: 502, receivedAt: '2026-09-14T12:00:17.350Z' }),
    preciseObs({ time: '2026-09-14T12:00:19.300000Z', price: 76003, sequence: 403, tradeId: 503, receivedAt: '2026-09-14T12:00:19.400Z' })
  ];
  const result = qualifyCoinbaseTickerSeries({ observations, now: BASE });
  assert.equal(result.canEvaluateFrozenFreshness, true);
  assert.equal(result.observation.exactTimestampDistinctEvents, 1);
  assert.equal(result.observation.exactTimestampIdentityConflicts, 0);
  assert.equal(result.observation.coarseTimestampObserved, false);
  assert.ok(result.semanticReasonCodes.includes('COINBASE_EXACT_TIMESTAMP_DISTINCT_EVENTS_DISAMBIGUATED_BY_EVENT_IDENTITY'));
  assert.equal(result.temporalAuthority.authorityGate, 'PASS');
});

test('fails closed on timestamp, sequence, or trade-id regression', () => {
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
  const sequenceResult = qualifyCoinbaseTickerSeries({ observations: sequenceRegression, now: BASE });
  assert.equal(sequenceResult.canEvaluateFrozenFreshness, false);
  assert.ok(sequenceResult.semanticReasonCodes.includes('COINBASE_TICKER_SEQUENCE_REGRESSION'));

  const tradeRegression = [
    preciseObs({ time: '2026-09-14T12:00:16.100000Z', price: 76000, sequence: 100, tradeId: 200, receivedAt: '2026-09-14T12:00:16.200Z' }),
    preciseObs({ time: '2026-09-14T12:00:17.100000Z', price: 76001, sequence: 101, tradeId: 201, receivedAt: '2026-09-14T12:00:17.200Z' }),
    preciseObs({ time: '2026-09-14T12:00:18.100000Z', price: 76002, sequence: 102, tradeId: 199, receivedAt: '2026-09-14T12:00:18.200Z' }),
    preciseObs({ time: '2026-09-14T12:00:19.100000Z', price: 76003, sequence: 103, tradeId: 202, receivedAt: '2026-09-14T12:00:19.200Z' })
  ];
  const tradeResult = qualifyCoinbaseTickerSeries({ observations: tradeRegression, now: BASE });
  assert.equal(tradeResult.canEvaluateFrozenFreshness, false);
  assert.ok(tradeResult.semanticReasonCodes.includes('COINBASE_TICKER_TRADE_ID_REGRESSION'));
});

test('fails closed when equal exact time changes price without advancing event identity', () => {
  const observations = [
    preciseObs({ time: '2026-09-14T12:00:16.100000Z', price: 76000, sequence: 400, tradeId: 500, receivedAt: '2026-09-14T12:00:16.300Z' }),
    preciseObs({ time: '2026-09-14T12:00:17.200000Z', price: 76001, sequence: 401, tradeId: 501, receivedAt: '2026-09-14T12:00:17.300Z' }),
    preciseObs({ time: '2026-09-14T12:00:17.200000Z', price: 76002, sequence: 401, tradeId: 501, receivedAt: '2026-09-14T12:00:17.350Z' }),
    preciseObs({ time: '2026-09-14T12:00:19.300000Z', price: 76003, sequence: 402, tradeId: 502, receivedAt: '2026-09-14T12:00:19.400Z' })
  ];
  const result = qualifyCoinbaseTickerSeries({ observations, now: BASE });
  assert.equal(result.canEvaluateFrozenFreshness, false);
  assert.equal(result.observation.exactTimestampIdentityConflicts, 1);
  assert.equal(result.observation.coarseTimestampObserved, true);
  assert.ok(result.semanticReasonCodes.includes('COINBASE_TICKER_EXACT_TIMESTAMP_IDENTITY_CONFLICT'));
});

test('fails closed when event/receive skew is excessive', () => {
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
