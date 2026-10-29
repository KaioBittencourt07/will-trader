import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyRestMarketSourceState } from './market.js';

const now = Date.parse('2026-10-29T12:00:00.000Z');

test('REST source is not probed when no upstream request is recorded', () => {
  assert.equal(classifyRestMarketSourceState({ upstreamRequests: 0, providerState: 'HEALTHY' }, now), 'CONFIGURED_NOT_PROBED');
  assert.equal(classifyRestMarketSourceState({}, now), 'CONFIGURED_NOT_PROBED');
});

test('REST source reports a pending first request as in progress, not failed', () => {
  assert.equal(classifyRestMarketSourceState({
    upstreamRequests: 1,
    providerState: 'HEALTHY',
    lastSuccessAt: null,
    lastErrorAt: null
  }, now), 'PROBE_IN_PROGRESS');
});

test('REST source distinguishes recent and stale successful observations', () => {
  assert.equal(classifyRestMarketSourceState({
    upstreamRequests: 2,
    providerState: 'HEALTHY',
    lastSuccessAt: new Date(now - 15_000).toISOString()
  }, now), 'OBSERVED_RECENT_SUCCESS');
  assert.equal(classifyRestMarketSourceState({
    upstreamRequests: 2,
    providerState: 'HEALTHY',
    lastSuccessAt: new Date(now - 31_000).toISOString()
  }, now), 'OBSERVED_STALE_SUCCESS');
});

test('REST source preserves failure, cooldown, and rate-limit states', () => {
  assert.equal(classifyRestMarketSourceState({
    upstreamRequests: 1, providerState: 'DEGRADED', lastErrorAt: new Date(now).toISOString()
  }, now), 'DEGRADED');
  assert.equal(classifyRestMarketSourceState({
    upstreamRequests: 1, providerState: 'RATE_LIMITED'
  }, now), 'RATE_LIMITED');
  assert.equal(classifyRestMarketSourceState({
    upstreamRequests: 1, providerState: 'COOLDOWN'
  }, now), 'COOLDOWN');
});

test('REST source reports an explicit probe error if a request failed before any success', () => {
  assert.equal(classifyRestMarketSourceState({
    upstreamRequests: 1,
    providerState: 'HEALTHY',
    lastSuccessAt: null,
    lastErrorAt: new Date(now).toISOString()
  }, now), 'PROBE_FAILED');
});
