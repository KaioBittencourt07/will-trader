import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTwelveWsTemporalAuthority } from '../backend/src/twelveWsTemporalAuthority.js';

function health({ now = 1_800_000_000_000, eventAgeMs = 500, receiveAgeMs = 200 } = {}) {
  return {
    mode: 'SHADOW_OBSERVABILITY',
    connected: true,
    subscriptionsAccepted: 1,
    symbols: [{
      symbol: 'EUR/USD',
      price: 1.2345,
      eventTimestamp: now - eventAgeMs,
      receivedAt: new Date(now - receiveAgeMs).toISOString()
    }]
  };
}

test('fails closed when WS event-time provenance is not verified', () => {
  const now = 1_800_000_000_000;
  const result = evaluateTwelveWsTemporalAuthority({
    wsHealth: health({ now }),
    symbol: 'EUR/USD',
    now
  });
  assert.equal(result.authorityGate, 'FAIL');
  assert.equal(result.freshnessGate, 'UNVERIFIED');
  assert.equal(result.timestampAuthority, 'UNRESOLVED');
  assert.ok(result.reasons.includes('WS_EVENT_TIME_PROVENANCE_NOT_VERIFIED'));
});

test('approves fresh WS event time only when provenance is explicitly verified', () => {
  const now = 1_800_000_000_000;
  const result = evaluateTwelveWsTemporalAuthority({
    wsHealth: health({ now, eventAgeMs: 800, receiveAgeMs: 300 }),
    symbol: 'EUR/USD',
    now,
    provenanceVerified: true
  });
  assert.equal(result.authorityGate, 'PASS');
  assert.equal(result.freshnessGate, 'PASS');
  assert.equal(result.timestampAuthority, 'WS_PROVIDER_EVENT_TIME');
  assert.equal(result.decisionImpact, 'ALLOW_ANALYSIS_ONLY');
});

test('rejects stale WS event time under frozen 30s contract', () => {
  const now = 1_800_000_000_000;
  const result = evaluateTwelveWsTemporalAuthority({
    wsHealth: health({ now, eventAgeMs: 31_500, receiveAgeMs: 200 }),
    symbol: 'EUR/USD',
    now,
    provenanceVerified: true
  });
  assert.equal(result.authorityGate, 'PASS');
  assert.equal(result.freshnessGate, 'FAIL');
  assert.equal(result.timestampAuthority, 'UNRESOLVED');
  assert.ok(result.reasons.includes('WS_EVENT_OLDER_THAN_FROZEN_CONTRACT'));
});

test('rejects missing or mismatched WS symbol evidence', () => {
  const now = 1_800_000_000_000;
  const result = evaluateTwelveWsTemporalAuthority({
    wsHealth: health({ now }),
    symbol: 'GBP/USD',
    now,
    provenanceVerified: true
  });
  assert.equal(result.authorityGate, 'FAIL');
  assert.ok(result.reasons.includes('WS_TICK_MISSING'));
});
