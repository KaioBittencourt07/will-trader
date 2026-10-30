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
  let requestShape;
  const healthy = await diagnoseTwelveData({ engine: { getSnapshot: async (...args) => { requestShape = args; return { valid: true }; } }, now: () => '2026-09-03T10:00:00.000Z' });
  const stale = await diagnoseTwelveData({ engine: { getSnapshot: async () => ({ valid: false, status: 'STALE' }) }, now: () => '2026-09-03T10:00:00.000Z' });
  const blocked = await diagnoseTwelveData({ engine: { getSnapshot: async () => { throw new Error('Twelve Data network error: EACCES'); } }, now: () => '2026-09-03T10:00:00.000Z' });
  assert.deepEqual({ ...healthy, freshness: undefined }, { ok: true, status: 'HEALTHY', checkedAt: '2026-09-03T10:00:00.000Z', version: 'twelve-data-diagnostic-v1', asset: 'EUR/USD', timeframe: '1min', freshness: undefined });
  assert.equal(healthy.freshness.freshnessBasis, null);
  assert.deepEqual(requestShape, ['EUR/USD', '1min', 50]);
  assert.equal(stale.status, 'STALE_DATA');
  assert.equal(blocked.status, 'NETWORK_BLOCKED');
});

test('diagnostic composes the already fetched snapshot once and fails closed on REST error', async () => {
  let fetches = 0;
  let compositions = 0;
  const healthy = await diagnoseTwelveData({
    engine: { getSnapshot: async () => { fetches += 1; return { valid: true }; } },
    composeShadow: (snapshot) => { compositions += 1; return { compositionState: snapshot ? 'COMPOSABLE' : 'UNKNOWN' }; }
  });
  assert.equal(fetches, 1);
  assert.equal(compositions, 1);
  assert.equal(healthy.compositionShadow.compositionState, 'COMPOSABLE');

  const failed = await diagnoseTwelveData({
    engine: { getSnapshot: async () => { throw Object.assign(new Error('rate limit'), { status: 429 }); } },
    composeShadow: (snapshot) => ({ compositionState: snapshot ? 'COMPOSABLE' : 'UNKNOWN' })
  });
  assert.equal(failed.status, 'RATE_LIMITED');
  assert.equal(failed.compositionShadow.compositionState, 'UNKNOWN');
});

