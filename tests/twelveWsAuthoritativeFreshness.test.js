import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateTwelveWsAuthoritativeFreshness } from '../backend/src/twelveWsAuthoritativeFreshness.js';

const fresh = { eventTimestamp: 1_000, eventTimestampUnit: 'UNIX_SECONDS', receiveTimestamp: 1_020_000, receiveTimestampUnit: 'UNIX_MILLISECONDS' };
const stale = { eventTimestamp: 1_000, eventTimestampUnit: 'UNIX_SECONDS', receiveTimestamp: 1_031_000, receiveTimestampUnit: 'UNIX_MILLISECONDS' };

test('blocks freshness when timestamp authority is unresolved', () => {
  const result = evaluateTwelveWsAuthoritativeFreshness(fresh);
  assert.equal(result.authorityGate, 'FAIL');
  assert.equal(result.freshnessGate, 'UNVERIFIED');
  assert.equal(result.blocker, 'TIMESTAMP_AUTHORITY_UNVERIFIED');
});

test('client receive time cannot produce freshness pass', () => {
  const result = evaluateTwelveWsAuthoritativeFreshness({ ...fresh, candidateAuthority:'CLIENT_RECEIVE_TIME', provenanceVerified:true, comparableToReceiveClock:true });
  assert.equal(result.timestampAuthority, 'CLIENT_RECEIVE_TIME_DIAGNOSTIC_ONLY');
  assert.equal(result.freshnessGate, 'UNVERIFIED');
});

test('provider bucket time cannot produce freshness pass', () => {
  const result = evaluateTwelveWsAuthoritativeFreshness({ ...fresh, candidateAuthority:'PROVIDER_BUCKET_TIME', provenanceVerified:true, comparableToReceiveClock:true, observedBucketPattern:true });
  assert.equal(result.timestampAuthority, 'PROVIDER_BUCKET_TIME_DESCRIPTIVE_ONLY');
  assert.equal(result.freshnessGate, 'UNVERIFIED');
  assert.equal(result.bucketTimeCanBypassFreshness, false);
});

test('verified provider event time may evaluate frozen freshness', () => {
  const result = evaluateTwelveWsAuthoritativeFreshness({ ...fresh, candidateAuthority:'PROVIDER_EVENT_TIME', provenanceVerified:true, comparableToReceiveClock:true });
  assert.equal(result.authorityGate, 'PASS');
  assert.equal(result.freshnessGate, 'PASS');
  assert.equal(result.eventAgeMs, 20_000);
  assert.equal(result.providerCommissioning, false);
  assert.equal(result.prospectivePaperAuthorized, false);
});

test('verified event time still fails if older than frozen contract', () => {
  const result = evaluateTwelveWsAuthoritativeFreshness({ ...stale, candidateAuthority:'EXCHANGE_EVENT_TIME', provenanceVerified:true, comparableToReceiveClock:true });
  assert.equal(result.authorityGate, 'PASS');
  assert.equal(result.freshnessGate, 'FAIL');
  assert.equal(result.eventAgeMs, 31_000);
  assert.equal(result.blocker, 'EVENT_OLDER_THAN_FROZEN_CONTRACT');
  assert.equal(result.ordersExecuted, 0);
});
