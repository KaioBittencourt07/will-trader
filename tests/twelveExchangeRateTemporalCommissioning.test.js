import assert from 'node:assert/strict';
import test from 'node:test';
import { runTwelveExchangeRateTemporalCommissioning } from '../backend/src/commissionTwelveExchangeRateTemporal.js';

const BASE = Date.parse('2026-09-14T12:00:20.000Z');

function response(payload, ok = true, status = 200) {
  return { ok, status, async json() { return payload; } };
}

test('bounded synthetic commissioning can approve coherent exchange_rate event time without exposing secrets', async () => {
  let calls = 0;
  const times = [BASE - 9_000, BASE - 6_000, BASE - 3_000, BASE];
  const fetchImpl = async () => {
    const index = calls++;
    return response({ symbol: 'EUR/USD', rate: 1.1 + index * 0.0001, timestamp: times[index] / 1000 });
  };
  let nowIndex = 0;
  const receiveTimes = [BASE - 8_500, BASE - 5_500, BASE - 2_500, BASE + 500, BASE + 500];
  const report = await runTwelveExchangeRateTemporalCommissioning({
    apiKey: 'synthetic-secret',
    fetchImpl,
    wait: async () => {},
    now: () => receiveTimes[Math.min(nowIndex++, receiveTimes.length - 1)],
    observationsTarget: 4,
    intervalMs: 1_000
  });
  assert.equal(report.status, 'APPROVED');
  assert.equal(report.requestsMade, 4);
  assert.equal(report.requestBudget, 4);
  assert.equal(report.temporalAuthority.authorityGate, 'PASS');
  assert.equal(report.temporalAuthority.freshnessGate, 'PASS');
  assert.equal(report.rawObservationsExposed, false);
  assert.equal(report.ordersExecuted, 0);
  assert.equal(JSON.stringify(report).includes('synthetic-secret'), false);
});

test('commissioning fails closed on provider HTTP failure and stops early', async () => {
  let calls = 0;
  const report = await runTwelveExchangeRateTemporalCommissioning({
    apiKey: 'synthetic-secret',
    fetchImpl: async () => { calls += 1; return response({}, false, 429); },
    wait: async () => {},
    now: () => BASE
  });
  assert.equal(report.status, 'BLOCKED');
  assert.equal(calls, 1);
  assert.equal(report.requestsMade, 1);
  assert.ok(report.failures[0].includes('429'));
  assert.equal(report.temporalApproved, false);
  assert.equal(report.ordersExecuted, 0);
});
