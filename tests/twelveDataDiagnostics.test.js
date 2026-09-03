import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyTwelveDataFailure, diagnoseTwelveData } from '../data/src/providers/twelveDataDiagnostics.js';

test('Twelve Data diagnostic distinguishes credential, rate limit, blocked network and invalid response', () => {
  assert.equal(classifyTwelveDataFailure(new Error('TWELVEDATA_API_KEY não configurada.')), 'CREDENTIAL_ERROR');
  assert.equal(classifyTwelveDataFailure(Object.assign(new Error('HTTP 429'), { status: 429 })), 'RATE_LIMITED');
  assert.equal(classifyTwelveDataFailure(new Error('Twelve Data network error: EACCES')), 'NETWORK_BLOCKED');
  assert.equal(classifyTwelveDataFailure(new Error('Twelve Data retornou snapshot incompleto.')), 'INVALID_RESPONSE');
  assert.equal(classifyTwelveDataFailure(new Error('DATA_STALE')), 'STALE_DATA');
});

test('diagnostic returns HEALTHY only for a valid snapshot and never invents one', async () => {
  const healthy = await diagnoseTwelveData({ engine: { getSnapshot: async () => ({ valid: true }) }, now: () => '2026-09-03T10:00:00.000Z' });
  const stale = await diagnoseTwelveData({ engine: { getSnapshot: async () => ({ valid: false, status: 'STALE' }) }, now: () => '2026-09-03T10:00:00.000Z' });
  const blocked = await diagnoseTwelveData({ engine: { getSnapshot: async () => { throw new Error('Twelve Data network error: EACCES'); } }, now: () => '2026-09-03T10:00:00.000Z' });
  assert.deepEqual(healthy, { ok: true, status: 'HEALTHY', checkedAt: '2026-09-03T10:00:00.000Z', version: 'twelve-data-diagnostic-v1', asset: 'EUR/USD', timeframe: '1min' });
  assert.equal(stale.status, 'STALE_DATA');
  assert.equal(blocked.status, 'NETWORK_BLOCKED');
});

