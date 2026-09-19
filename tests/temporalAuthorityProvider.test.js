import assert from 'node:assert/strict';
import test from 'node:test';
import { createTemporalAuthorityProvider, qualifyTemporalAuthorityObservation } from '../backend/src/temporalAuthorityProvider.js';

const NOW = Date.parse('2026-09-14T12:00:20.000Z');

function good(overrides = {}) {
  return {
    provider: 'synthetic-time', symbol: 'EUR/USD', eventTimestamp: NOW - 5_000,
    receivedAt: new Date(NOW - 1_000).toISOString(), timestampAuthority: 'SYNTHETIC_PROVIDER_EVENT_TIME',
    provenanceVerified: true, perEventSemanticsVerified: true, now: NOW, ...overrides
  };
}

test('approves only explicit per-event provider time inside frozen 30s window', () => {
  const value = qualifyTemporalAuthorityObservation(good());
  assert.equal(value.authorityGate, 'PASS');
  assert.equal(value.freshnessGate, 'PASS');
  assert.equal(value.timestampAuthority, 'SYNTHETIC_PROVIDER_EVENT_TIME');
  assert.equal(value.decisionImpact, 'ALLOW_ANALYSIS_ONLY');
  assert.equal(value.ordersExecuted, 0);
});

test('field provenance alone is insufficient', () => {
  const value = qualifyTemporalAuthorityObservation(good({ perEventSemanticsVerified: false }));
  assert.equal(value.authorityGate, 'FAIL');
  assert.equal(value.freshnessGate, 'UNVERIFIED');
  assert.equal(value.timestampAuthority, 'UNRESOLVED');
  assert.ok(value.reasons.includes('TEMPORAL_PER_EVENT_SEMANTICS_NOT_VERIFIED'));
});

test('stale event fails freshness without weakening authority semantics', () => {
  const value = qualifyTemporalAuthorityObservation(good({ eventTimestamp: NOW - 30_001 }));
  assert.equal(value.authorityGate, 'PASS');
  assert.equal(value.freshnessGate, 'FAIL');
  assert.equal(value.freshnessContractMs, 30_000);
});

test('future event and altered freshness contract fail closed', () => {
  assert.equal(qualifyTemporalAuthorityObservation(good({ eventTimestamp: NOW + 1_001 })).authorityGate, 'FAIL');
  assert.ok(qualifyTemporalAuthorityObservation(good({ maxAgeMs: 30_001 })).reasons.includes('TEMPORAL_FRESHNESS_GATE_FROZEN'));
});

test('provider wrapper normalizes observation through the same contract', async () => {
  const provider = createTemporalAuthorityProvider({ id: 'synthetic-time', observe: async () => good() });
  const value = await provider.getAuthority('EUR/USD', { now: NOW });
  assert.equal(value.authorityGate, 'PASS');
  assert.equal(value.symbol, 'EUR/USD');
});
