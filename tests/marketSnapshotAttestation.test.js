import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attestMarketSnapshot,
  clearMarketSnapshotAttestationsForTest,
  resolveMarketSnapshotAttestation
} from '../backend/src/marketSnapshotAttestation.js';

function snapshot() {
  return {
    asset: 'EUR/USD',
    timeframe: '1min',
    source: 'twelvedata',
    price: 1.17,
    timestamp: '2026-09-12T06:00:00.000Z',
    trend: 0.25,
    authoritativeFreshness: {
      serverDerived: true,
      authorityGate: 'FAIL',
      freshnessGate: 'UNVERIFIED'
    }
  };
}

test('attests and resolves an unchanged snapshot inside frozen TTL', () => {
  clearMarketSnapshotAttestationsForTest();
  const base = snapshot();
  const attestation = attestMarketSnapshot(base, { now: () => 1_000 });
  const result = resolveMarketSnapshotAttestation({ ...base, snapshotAttestationId: attestation.id }, { now: () => 10_000 });
  assert.equal(result.ok, true);
  assert.equal(result.authoritativeFreshness.serverDerived, true);
});

test('rejects missing attestation id', () => {
  clearMarketSnapshotAttestationsForTest();
  const result = resolveMarketSnapshotAttestation(snapshot(), { now: () => 1_000 });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SNAPSHOT_ATTESTATION_REQUIRED');
});

test('rejects tampered snapshot fields even when id is valid', () => {
  clearMarketSnapshotAttestationsForTest();
  const base = snapshot();
  const attestation = attestMarketSnapshot(base, { now: () => 1_000 });
  const result = resolveMarketSnapshotAttestation({ ...base, price: 9.99, snapshotAttestationId: attestation.id }, { now: () => 2_000 });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SNAPSHOT_ATTESTATION_FINGERPRINT_MISMATCH');
});

test('client freshness edits do not affect fingerprint and are replaced from registry', () => {
  clearMarketSnapshotAttestationsForTest();
  const base = snapshot();
  const attestation = attestMarketSnapshot(base, { now: () => 1_000 });
  const result = resolveMarketSnapshotAttestation({
    ...base,
    authoritativeFreshness: { serverDerived: false, authorityGate: 'PASS', freshnessGate: 'PASS' },
    snapshotAttestationId: attestation.id
  }, { now: () => 2_000 });
  assert.equal(result.ok, true);
  assert.equal(result.authoritativeFreshness.authorityGate, 'FAIL');
  assert.equal(result.authoritativeFreshness.freshnessGate, 'UNVERIFIED');
});

test('expired attestation fails closed', () => {
  clearMarketSnapshotAttestationsForTest();
  const base = snapshot();
  const attestation = attestMarketSnapshot(base, { now: () => 1_000 });
  const result = resolveMarketSnapshotAttestation({ ...base, snapshotAttestationId: attestation.id }, { now: () => 31_001 });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SNAPSHOT_ATTESTATION_MISSING_OR_EXPIRED');
});

test('attestation requires server-derived freshness and frozen TTL', () => {
  clearMarketSnapshotAttestationsForTest();
  assert.throws(() => attestMarketSnapshot({ asset: 'EUR/USD' }), /REQUIRES_SERVER_FRESHNESS/);
  assert.throws(() => attestMarketSnapshot(snapshot(), { ttlMs: 60_000 }), /TTL_FROZEN/);
});
