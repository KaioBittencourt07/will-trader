import assert from 'node:assert/strict';
import test from 'node:test';
import { observationFromTwelveExchangeRate, qualifyTwelveExchangeRateSeries } from '../backend/src/twelveExchangeRateTemporalQualification.js';

const BASE = Date.parse('2026-09-14T12:00:20.000Z');
const obs = (offsetMs, rate = 1.1) => observationFromTwelveExchangeRate({
  payload: { symbol: 'EUR/USD', rate, timestamp: (BASE + offsetMs) / 1000 },
  receivedAt: new Date(BASE + offsetMs + 500).toISOString()
});

test('extracts documented exchange_rate timestamp provenance but does not self-approve one observation', () => {
  const value = observationFromTwelveExchangeRate({
    payload: { symbol: 'EUR/USD', rate: 1.1001, timestamp: BASE / 1000 },
    receivedAt: new Date(BASE + 500).toISOString()
  });
  assert.equal(value.provider, 'twelvedata-exchange-rate');
  assert.equal(value.timestampAuthority, 'TWELVE_EXCHANGE_RATE_PROVIDER_EVENT_TIME');
  assert.equal(value.provenanceVerified, true);
  assert.equal(value.perEventSemanticsVerified, false);
});

test('approves coherent runtime progression only after enough observations', () => {
  const observations = [obs(-9_000, 1.1000), obs(-6_000, 1.1001), obs(-3_000, 1.1002), obs(0, 1.1003)];
  const result = qualifyTwelveExchangeRateSeries({ observations, now: BASE + 500 });
  assert.equal(result.canEvaluateFrozenFreshness, true);
  assert.equal(result.observation.acceptedObservations, 4);
  assert.equal(result.observation.distinctEventTimestamps, 4);
  assert.equal(result.observation.timestampRegressions, 0);
  assert.equal(result.temporalAuthority.authorityGate, 'PASS');
  assert.equal(result.temporalAuthority.freshnessGate, 'PASS');
});

test('fails closed when changing rates share one timestamp', () => {
  const t = BASE - 2_000;
  const observations = [1.1, 1.1001, 1.1002, 1.1003].map((rate, index) => observationFromTwelveExchangeRate({
    payload: { symbol: 'EUR/USD', rate, timestamp: t / 1000 },
    receivedAt: new Date(BASE - 1_500 + index * 100).toISOString()
  }));
  const result = qualifyTwelveExchangeRateSeries({ observations, now: BASE });
  assert.equal(result.canEvaluateFrozenFreshness, false);
  assert.equal(result.observation.coarseTimestampObserved, true);
  assert.ok(result.semanticReasonCodes.includes('EXCHANGE_RATE_RATE_CHANGES_SHARE_TIMESTAMP'));
});

test('fails closed on regressions or excessive event/receive skew', () => {
  const regressed = [obs(-9_000), obs(-6_000), obs(-7_000), obs(-3_000)];
  assert.equal(qualifyTwelveExchangeRateSeries({ observations: regressed, now: BASE }).canEvaluateFrozenFreshness, false);
  const skewed = [0, 1, 2, 3].map((i) => observationFromTwelveExchangeRate({
    payload: { symbol: 'EUR/USD', rate: 1.1 + i * 0.0001, timestamp: (BASE - 20_000 + i * 1_000) / 1000 },
    receivedAt: new Date(BASE + i * 1_000).toISOString()
  }));
  const result = qualifyTwelveExchangeRateSeries({ observations: skewed, now: BASE + 3_000 });
  assert.equal(result.canEvaluateFrozenFreshness, false);
  assert.ok(result.semanticReasonCodes.includes('EXCHANGE_RATE_EVENT_RECEIVE_SKEW_TOO_LARGE'));
});

test('malformed symbol, rate, timestamp and receive time are rejected', () => {
  assert.throws(() => observationFromTwelveExchangeRate({ payload: { rate: 1, timestamp: BASE / 1000 }, receivedAt: new Date(BASE).toISOString() }), /SYMBOL_MISSING/);
  assert.throws(() => observationFromTwelveExchangeRate({ payload: { symbol: 'EUR/USD', rate: 0, timestamp: BASE / 1000 }, receivedAt: new Date(BASE).toISOString() }), /RATE_INVALID/);
  assert.throws(() => observationFromTwelveExchangeRate({ payload: { symbol: 'EUR/USD', rate: 1 }, receivedAt: new Date(BASE).toISOString() }), /TIMESTAMP_MISSING/);
});
