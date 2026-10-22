import assert from 'node:assert/strict';
import test from 'node:test';
import { attachMarketAuthoritativeFreshness, buildMarketAuthoritativeFreshness } from '../backend/src/marketAuthoritativeFreshness.js';

test('missing Twelve timestamp provenance stays unverified and blocked server-side', () => {
  const result = buildMarketAuthoritativeFreshness({ source: 'twelvedata', freshnessBasis: 'REST_QUOTE_TIMESTAMP', ageMs: 5_000 });
  assert.equal(result.serverDerived, true);
  assert.equal(result.timestampAuthorityEvidence.semanticClassification, 'DATA_INVALID');
  assert.equal(result.timestampAuthority, 'UNRESOLVED');
  assert.equal(result.authorityGate, 'FAIL');
  assert.equal(result.freshnessGate, 'UNVERIFIED');
  assert.equal(result.blocker, 'TIMESTAMP_AUTHORITY_UNVERIFIED');
  assert.equal(result.freshnessContractMs, 30_000);
});

test('Twelve quote timestamp provenance becomes provider bucket time automatically', () => {
  const result = buildMarketAuthoritativeFreshness({ source: 'twelvedata', ageMs: 5_000, timestampOrigins: { quoteTimestampField: 'timestamp' } });
  assert.equal(result.timestampAuthorityEvidence.source, 'SERVER_TWELVE_REST_SEMANTIC_QUALIFICATION');
  assert.equal(result.timestampAuthorityEvidence.fieldName, 'timestamp');
  assert.equal(result.timestampAuthorityEvidence.semanticClassification, 'PROVIDER_BUCKET_TIME');
  assert.equal(result.timestampAuthority, 'PROVIDER_BUCKET_TIME_DESCRIPTIVE_ONLY');
  assert.equal(result.authorityGate, 'FAIL');
  assert.equal(result.freshnessGate, 'UNVERIFIED');
});

test('Twelve last_update_at provenance remains unresolved automatically', () => {
  const result = buildMarketAuthoritativeFreshness({ source: 'twelvedata', ageMs: 5_000, timestampOrigins: { quoteTimestampField: 'last_update_at' } });
  assert.equal(result.timestampAuthorityEvidence.semanticClassification, 'RECENT_QUOTE_TIME_SEMANTICS_UNRESOLVED');
  assert.equal(result.timestampAuthority, 'UNRESOLVED');
  assert.deepEqual(result.authorityReasonCodes, ['TIMESTAMP_AUTHORITY_UNRESOLVED']);
  assert.equal(result.authorityGate, 'FAIL');
  assert.equal(result.freshnessGate, 'UNVERIFIED');
});

test('Twelve last_quote_at provenance remains unresolved automatically', () => {
  const result = buildMarketAuthoritativeFreshness({ source: 'twelvedata', ageMs: 5_000, timestampOrigins: { quoteTimestampField: 'last_quote_at' } });
  assert.equal(result.timestampAuthorityEvidence.semanticClassification, 'LAST_QUOTE_AT_SEMANTICS_UNRESOLVED');
  assert.equal(result.timestampAuthority, 'UNRESOLVED');
  assert.deepEqual(result.authorityReasonCodes, ['TIMESTAMP_AUTHORITY_UNRESOLVED']);
  assert.equal(result.authorityGate, 'FAIL');
  assert.equal(result.freshnessGate, 'UNVERIFIED');
});

test('Twelve ignores client-supplied authority evidence and derives from server provenance', () => {
  const result = buildMarketAuthoritativeFreshness({
    source: 'twelvedata', ageMs: 1_000, timestampOrigins: { quoteTimestampField: 'timestamp' },
    timestampAuthorityEvidence: { candidateAuthority: 'PROVIDER_EVENT_TIME', provenanceVerified: true, comparableToReceiveClock: true, observedBucketPattern: false }
  });
  assert.equal(result.timestampAuthorityEvidence.fieldName, 'timestamp');
  assert.equal(result.timestampAuthority, 'PROVIDER_BUCKET_TIME_DESCRIPTIVE_ONLY');
  assert.equal(result.authorityGate, 'FAIL');
  assert.equal(result.freshnessGate, 'UNVERIFIED');
});

test('Coinbase last-trade timestamp is derived from the server allowlist and permits fresh snapshots', () => {
  const eventAt = '2026-10-22T15:00:00.000Z';
  const receivedAt = '2026-10-22T15:00:01.000Z';
  const result = buildMarketAuthoritativeFreshness({
    source: 'coinbase-exchange-rest', ageMs: 1_000, quoteAgeMs: 1_000,
    timestamp: eventAt, quoteTimestamp: eventAt, providerReceivedAt: receivedAt,
    timestampOrigins: { quoteTimestampField: 'ticker.time' },
    timestampAuthorityEvidence: { candidateAuthority: 'PROVIDER_EVENT_TIME', provenanceVerified: true, comparableToReceiveClock: true }
  });
  assert.equal(result.timestampAuthorityEvidence.source, 'SERVER_PUBLIC_EXCHANGE_TIMESTAMP_QUALIFICATION');
  assert.equal(result.timestampAuthorityEvidence.semantic, 'LAST_TRADE_EVENT_TIMESTAMP');
  assert.equal(result.timestampAuthority, 'EXCHANGE_EVENT_TIME_SUPPORTED');
  assert.equal(result.authorityGate, 'PASS');
  assert.equal(result.freshnessGate, 'PASS');
});

test('Binance trade time never accepts a different field name or a client assertion', () => {
  const eventAt = '2026-10-22T15:00:00.000Z';
  const result = buildMarketAuthoritativeFreshness({
    source: 'binance-spot-rest', ageMs: 1_000, quoteAgeMs: 1_000,
    timestamp: eventAt, quoteTimestamp: eventAt, providerReceivedAt: '2026-10-22T15:00:01.000Z',
    timestampOrigins: { quoteTimestampField: 'ticker24hr.closeTime' },
    timestampAuthorityEvidence: { candidateAuthority: 'EXCHANGE_EVENT_TIME', provenanceVerified: true, comparableToReceiveClock: true, observedBucketPattern: false }
  });
  assert.equal(result.timestampAuthorityEvidence.semantic, 'UNRESOLVED');
  assert.equal(result.authorityGate, 'FAIL');
  assert.equal(result.freshnessGate, 'UNVERIFIED');
});

test('public exchange quotes from the future or too stale do not obtain freshness authority', () => {
  const future = buildMarketAuthoritativeFreshness({
    source: 'coinbase-exchange-rest', ageMs: -3_000, quoteAgeMs: -3_000,
    timestamp: '2026-10-22T15:00:03.000Z', quoteTimestamp: '2026-10-22T15:00:03.000Z',
    providerReceivedAt: '2026-10-22T15:00:00.000Z',
    timestampOrigins: { quoteTimestampField: 'ticker.time' }
  });
  assert.equal(future.authorityGate, 'FAIL');
  assert.equal(future.freshnessGate, 'UNVERIFIED');

  const stale = buildMarketAuthoritativeFreshness({
    source: 'binance-spot-rest', ageMs: 31_000, quoteAgeMs: 31_000,
    timestamp: '2026-10-22T14:59:29.000Z', quoteTimestamp: '2026-10-22T14:59:29.000Z',
    providerReceivedAt: '2026-10-22T15:00:00.000Z',
    timestampOrigins: { quoteTimestampField: 'trades[0].time' }
  });
  assert.equal(stale.authorityGate, 'FAIL');
  assert.equal(stale.freshnessGate, 'UNVERIFIED');
});

test('controlled fixture adapters can provide explicit event evidence in unit tests', () => {
  const result = buildMarketAuthoritativeFreshness({
    source: 'unknown-public', ageMs: 1_000,
    timestampAuthorityEvidence: { candidateAuthority: 'PROVIDER_EVENT_TIME', provenanceVerified: true, comparableToReceiveClock: true, observedBucketPattern: false }
  });
  assert.equal(result.authorityGate, 'PASS');
});

test('verified event time fails when older than frozen contract', () => {
  const result = buildMarketAuthoritativeFreshness({
    source: 'fixture', ageMs: 30_001,
    timestampAuthorityEvidence: { candidateAuthority: 'EXCHANGE_EVENT_TIME', provenanceVerified: true, comparableToReceiveClock: true, observedBucketPattern: false }
  });
  assert.equal(result.authorityGate, 'PASS');
  assert.equal(result.freshnessGate, 'FAIL');
  assert.equal(result.blocker, 'EVENT_OLDER_THAN_FROZEN_CONTRACT');
});

test('null, string and missing age never become a synthetic zero-age freshness pass', () => {
  for (const ageMs of [null, '', '0', undefined]) {
    const result = buildMarketAuthoritativeFreshness({
      source: 'fixture', ageMs,
      timestampAuthorityEvidence: { candidateAuthority: 'PROVIDER_EVENT_TIME', provenanceVerified: true, comparableToReceiveClock: true, observedBucketPattern: false }
    });
    assert.equal(result.eventAgeMs, null);
    assert.equal(result.freshnessGate, 'UNVERIFIED');
    assert.equal(result.blocker, 'MARKET_AGE_UNAVAILABLE');
  }
});


test('public exchange clock comparison rejects inconsistent event age evidence', () => {
  const result = buildMarketAuthoritativeFreshness({
    source: 'coinbase-exchange-rest',
    ageMs: 1_000,
    quoteAgeMs: 1_000,
    timestamp: '2026-10-22T15:00:00.000Z',
    quoteTimestamp: '2026-10-22T15:00:00.000Z',
    providerReceivedAt: '2026-10-22T15:00:20.000Z',
    timestampOrigins: { quoteTimestampField: 'ticker.time' }
  });
  assert.equal(result.authorityGate, 'FAIL');
  assert.equal(result.freshnessGate, 'UNVERIFIED');
  assert.ok(result.timestampAuthorityEvidence.reasonCodes.includes('PUBLIC_EXCHANGE_EVENT_AGE_MISMATCH'));
});


test('attachment overwrites any client-like authoritative freshness with server derivation', () => {
  const snapshot = attachMarketAuthoritativeFreshness({
    source: 'twelvedata', ageMs: 1_000, timestampOrigins: { quoteTimestampField: 'timestamp' },
    authoritativeFreshness: { authorityGate: 'PASS', freshnessGate: 'PASS' }
  });
  assert.equal(snapshot.authoritativeFreshness.serverDerived, true);
  assert.equal(snapshot.authoritativeFreshness.authorityGate, 'FAIL');
  assert.equal(snapshot.authoritativeFreshness.freshnessGate, 'UNVERIFIED');
});
