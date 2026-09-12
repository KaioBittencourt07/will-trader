import assert from 'node:assert/strict';
import test from 'node:test';
import { attachMarketAuthoritativeFreshness, buildMarketAuthoritativeFreshness } from '../backend/src/marketAuthoritativeFreshness.js';

test('unverified provider timestamp stays blocked server-side', () => {
  const result = buildMarketAuthoritativeFreshness({ source: 'twelvedata', freshnessBasis: 'REST_QUOTE_TIMESTAMP', ageMs: 5_000 });
  assert.equal(result.serverDerived, true);
  assert.equal(result.authorityGate, 'FAIL');
  assert.equal(result.freshnessGate, 'UNVERIFIED');
  assert.equal(result.blocker, 'TIMESTAMP_AUTHORITY_DATA_INVALID');
  assert.equal(result.freshnessContractMs, 30_000);
});

test('Twelve quote timestamp provenance becomes provider bucket time automatically', () => {
  const result = buildMarketAuthoritativeFreshness({
    source: 'twelvedata', ageMs: 5_000,
    timestampOrigins: { quoteTimestampField: 'timestamp' }
  });
  assert.equal(result.timestampAuthorityEvidence.source, 'SERVER_TWELVE_REST_SEMANTIC_QUALIFICATION');
  assert.equal(result.timestampAuthorityEvidence.fieldName, 'timestamp');
  assert.equal(result.timestampAuthorityEvidence.semanticClassification, 'PROVIDER_BUCKET_TIME');
  assert.equal(result.timestampAuthority, 'PROVIDER_BUCKET_TIME_DESCRIPTIVE_ONLY');
  assert.equal(result.authorityGate, 'FAIL');
  assert.equal(result.freshnessGate, 'UNVERIFIED');
});

test('Twelve last_update_at provenance remains unresolved automatically', () => {
  const result = buildMarketAuthoritativeFreshness({
    source: 'twelvedata', ageMs: 5_000,
    timestampOrigins: { quoteTimestampField: 'last_update_at' }
  });
  assert.equal(result.timestampAuthorityEvidence.semanticClassification, 'RECENT_QUOTE_TIME_SEMANTICS_UNRESOLVED');
  assert.equal(result.timestampAuthority, 'TIMESTAMP_AUTHORITY_UNVERIFIED');
  assert.equal(result.authorityGate, 'FAIL');
  assert.equal(result.freshnessGate, 'UNVERIFIED');
});

test('Twelve last_quote_at provenance remains unresolved automatically', () => {
  const result = buildMarketAuthoritativeFreshness({
    source: 'twelvedata', ageMs: 5_000,
    timestampOrigins: { quoteTimestampField: 'last_quote_at' }
  });
  assert.equal(result.timestampAuthorityEvidence.semanticClassification, 'LAST_QUOTE_AT_SEMANTICS_UNRESOLVED');
  assert.equal(result.timestampAuthority, 'TIMESTAMP_AUTHORITY_UNVERIFIED');
  assert.equal(result.authorityGate, 'FAIL');
  assert.equal(result.freshnessGate, 'UNVERIFIED');
});

test('Twelve ignores client-supplied authority evidence and derives from server provenance', () => {
  const result = buildMarketAuthoritativeFreshness({
    source: 'twelvedata', ageMs: 1_000,
    timestampOrigins: { quoteTimestampField: 'timestamp' },
    timestampAuthorityEvidence: {
      candidateAuthority: 'PROVIDER_EVENT_TIME', provenanceVerified: true,
      comparableToReceiveClock: true, observedBucketPattern: false
    }
  });
  assert.equal(result.timestampAuthorityEvidence.fieldName, 'timestamp');
  assert.equal(result.timestampAuthority, 'PROVIDER_BUCKET_TIME_DESCRIPTIVE_ONLY');
  assert.equal(result.authorityGate, 'FAIL');
  assert.equal(result.freshnessGate, 'UNVERIFIED');
});

test('verified provider event time may pass frozen freshness only for non-Twelve controlled evidence', () => {
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
    source: 'fixture', ageMs: 30_001,
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

test('null, string and missing age never become a synthetic zero-age freshness pass', () => {
  for (const ageMs of [null, '', '0', undefined]) {
    const result = buildMarketAuthoritativeFreshness({
      source: 'fixture', ageMs,
      timestampAuthorityEvidence: {
        candidateAuthority: 'PROVIDER_EVENT_TIME', provenanceVerified: true,
        comparableToReceiveClock: true, observedBucketPattern: false
      }
    });
    assert.equal(result.eventAgeMs, null);
    assert.equal(result.freshnessGate, 'UNVERIFIED');
    assert.equal(result.blocker, 'MARKET_AGE_UNAVAILABLE');
  }
});

test('attachment overwrites any client-like authoritative freshness with server derivation', () => {
  const snapshot = attachMarketAuthoritativeFreshness({
    source: 'twelvedata', ageMs: 1_000,
    timestampOrigins: { quoteTimestampField: 'timestamp' },
    authoritativeFreshness: { authorityGate: 'PASS', freshnessGate: 'PASS' }
  });
  assert.equal(snapshot.authoritativeFreshness.serverDerived, true);
  assert.equal(snapshot.authoritativeFreshness.authorityGate, 'FAIL');
  assert.equal(snapshot.authoritativeFreshness.freshnessGate, 'UNVERIFIED');
});
