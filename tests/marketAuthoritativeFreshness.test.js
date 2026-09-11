import assert from 'node:assert/strict';
import test from 'node:test';
import { attachMarketAuthoritativeFreshness, buildMarketAuthoritativeFreshness } from '../backend/src/marketAuthoritativeFreshness.js';

test('unverified provider timestamp stays blocked server-side', () => {
  const result = buildMarketAuthoritativeFreshness({ source: 'twelvedata', freshnessBasis: 'REST_QUOTE_TIMESTAMP', ageMs: 5_000 });
  assert.equal(result.serverDerived, true);
  assert.equal(result.authorityGate, 'FAIL');
  assert.equal(result.freshnessGate, 'UNVERIFIED');
  assert.equal(result.blocker, 'TIMESTAMP_AUTHORITY_UNVERIFIED');
  assert.equal(result.freshnessContractMs, 30_000);
});

test('verified provider event time may pass frozen freshness only', () => {
  const result = buildMarketAuthoritativeFreshness({
    source: 'fixture',
    ageMs: 12_000,
    timestampAuthorityEvidence: {
      candidateAuthority: 'PROVIDER_EVENT_TIME',
      provenanceVerified: true,
      comparableToReceiveClock: true,
      observedBucketPattern: false
    }
  });
  assert.equal(result.authorityGate, 'PASS');
  assert.equal(result.freshnessGate, 'PASS');
  assert.equal(result.providerCommissioning, false);
  assert.equal(result.prospectivePaperAuthorized, false);
  assert.equal(result.ordersExecuted, 0);
});

test('verified event time fails when older than frozen contract', () => {
  const result = buildMarketAuthoritativeFreshness({
    ageMs: 30_001,
    timestampAuthorityEvidence: {
      candidateAuthority: 'EXCHANGE_EVENT_TIME',
      provenanceVerified: true,
      comparableToReceiveClock: true,
      observedBucketPattern: false
    }
  });
  assert.equal(result.authorityGate, 'PASS');
  assert.equal(result.freshnessGate, 'FAIL');
  assert.equal(result.blocker, 'EVENT_OLDER_THAN_FROZEN_CONTRACT');
});

test('attachment overwrites any client-like authoritative freshness with server derivation', () => {
  const snapshot = attachMarketAuthoritativeFreshness({
    source: 'twelvedata',
    ageMs: 1_000,
    authoritativeFreshness: { authorityGate: 'PASS', freshnessGate: 'PASS' }
  });
  assert.equal(snapshot.authoritativeFreshness.serverDerived, true);
  assert.equal(snapshot.authoritativeFreshness.authorityGate, 'FAIL');
  assert.equal(snapshot.authoritativeFreshness.freshnessGate, 'UNVERIFIED');
});
