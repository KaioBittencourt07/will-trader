import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFreshnessGuardedConsensus } from '../backend/src/freshnessGuardedConsensus.js';

const deterministic = {
  direction: 'BUY',
  executable: true,
  confidence: 80,
  clickTime: '2026-09-11T19:30:00.000Z'
};

const ai = { direction: 'BUY', confidence: 90, thesis: 'confirmed', risks: [] };

const fresh = {
  authorityGate: 'PASS',
  freshnessGate: 'PASS',
  freshnessContractMs: 30_000,
  timestampAuthority: 'PROVIDER_EVENT_TIME_SUPPORTED'
};

test('blocks consensus when timestamp authority is unverified', () => {
  const result = resolveFreshnessGuardedConsensus(deterministic, ai, {
    authorityGate: 'FAIL',
    freshnessGate: 'UNVERIFIED'
  });
  assert.equal(result.approved, false);
  assert.equal(result.decision.direction, 'WAIT');
  assert.equal(result.decision.executable, false);
  assert.equal(result.decision.clickTime, null);
  assert.ok(result.decision.blockReasons.includes('AUTHORITATIVE_FRESHNESS_REQUIRED'));
});

test('blocks consensus when authoritative data is stale', () => {
  const result = resolveFreshnessGuardedConsensus(deterministic, ai, {
    authorityGate: 'PASS',
    freshnessGate: 'FAIL'
  });
  assert.equal(result.approved, false);
  assert.equal(result.decision.direction, 'WAIT');
});

test('allows normal consensus only after authoritative freshness passes', () => {
  const result = resolveFreshnessGuardedConsensus(deterministic, ai, fresh);
  assert.equal(result.approved, true);
  assert.equal(result.decision.direction, 'BUY');
  assert.equal(result.freshnessGate, 'PASS');
  assert.equal(result.authorityGate, 'PASS');
});

test('freshness pass grants no PAPER, commissioning, or order authority', () => {
  const result = resolveFreshnessGuardedConsensus(deterministic, ai, fresh);
  assert.equal(result.providerCommissioning, false);
  assert.equal(result.prospectivePaperAuthorized, false);
  assert.equal(result.ordersExecuted, 0);
});
