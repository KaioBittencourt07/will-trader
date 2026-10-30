import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeOandaTemporalObservations, runOandaTemporalCommissioning } from '../backend/src/oandaTemporalCommissioning.js';

const NOW = Date.parse('2026-09-14T12:00:10.000Z');

function observations() {
  return [
    { eventTimestamp: NOW - 3_000, receivedAt: new Date(NOW - 2_000).toISOString(), price: 1.10 },
    { eventTimestamp: NOW - 2_000, receivedAt: new Date(NOW - 1_000).toISOString(), price: 1.1001 },
    { eventTimestamp: NOW - 1_000, receivedAt: new Date(NOW).toISOString(), price: 1.1002 }
  ];
}

test('qualifies coherent progressive event timestamps', () => {
  const value = analyzeOandaTemporalObservations(observations(), { now: NOW });
  assert.equal(value.perEventSemanticsVerified, true);
  assert.equal(value.temporalAuthority.authorityGate, 'PASS');
  assert.equal(value.temporalAuthority.freshnessGate, 'PASS');
  assert.equal(value.rawSequenceStored, false);
  assert.equal(value.ordersExecuted, 0);
});

test('fails closed on repeated timestamp with changing price', () => {
  const value = analyzeOandaTemporalObservations([
    { eventTimestamp: NOW - 2_000, receivedAt: new Date(NOW - 1_500).toISOString(), price: 1.10 },
    { eventTimestamp: NOW - 2_000, receivedAt: new Date(NOW - 1_000).toISOString(), price: 1.1001 },
    { eventTimestamp: NOW - 1_000, receivedAt: new Date(NOW).toISOString(), price: 1.1002 }
  ], { now: NOW });
  assert.equal(value.coarseTimestampObserved, true);
  assert.equal(value.perEventSemanticsVerified, false);
  assert.equal(value.temporalAuthority.authorityGate, 'FAIL');
});

test('fails closed on excessive event receive skew', () => {
  const sample = observations().map((item) => ({ ...item, receivedAt: new Date(item.eventTimestamp + 6_000).toISOString() }));
  const value = analyzeOandaTemporalObservations(sample, { now: NOW, maximumAllowedSkewMs: 5_000 });
  assert.equal(value.receiveClockCoherent, false);
  assert.equal(value.perEventSemanticsVerified, false);
});

test('commissioning blocks before external access without credentials', async () => {
  let calls = 0;
  const report = await runOandaTemporalCommissioning({ fetchImpl: async () => { calls += 1; } });
  assert.equal(report.result, 'BLOCKED_CONFIGURATION');
  assert.equal(report.externalCalls, 0);
  assert.equal(calls, 0);
});

test('bounded synthetic commissioning observes only pricing and never orders', async () => {
  let index = 0;
  const times = [NOW - 3_000, NOW - 2_000, NOW - 1_000];
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async json() {
      const t = times[Math.min(index, times.length - 1)];
      index += 1;
      return { prices: [{ instrument: 'EUR_USD', time: new Date(t).toISOString(), closeoutBid: '1.1000', closeoutAsk: String(1.1002 + index * 0.0001) }] };
    }
  });
  let nowValue = NOW - 2_000;
  const report = await runOandaTemporalCommissioning({
    token: 'test-value', accountId: 'test-account', fetchImpl,
    now: () => { nowValue += 500; return nowValue; }, wait: async () => {}, observations: 3
  });
  assert.equal(report.externalCalls, 3);
  assert.equal(report.ordersExecuted, 0);
  assert.equal(report.secretExposed, false);
  assert.equal(report.rawSequenceStored, false);
});
