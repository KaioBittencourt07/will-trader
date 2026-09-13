import { createHash, randomUUID } from 'node:crypto';

export const MARKET_SNAPSHOT_ATTESTATION_VERSION = 'market-snapshot-attestation-v1';
export const MARKET_SNAPSHOT_ATTESTATION_TTL_MS = 30_000;

const registry = new Map();
const ATTESTATION_ENVELOPE_KEYS = new Set([
  'snapshotAttestationId',
  'snapshotAttestationVersion',
  'snapshotAttestationExpiresAt'
]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => key !== 'authoritativeFreshness' && !ATTESTATION_ENVELOPE_KEYS.has(key))
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
}

function fingerprint(snapshot) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(snapshot)))
    .digest('hex');
}

function purgeExpired(nowMs) {
  for (const [id, record] of registry) {
    if (record.expiresAtMs <= nowMs) registry.delete(id);
  }
}

export function attestMarketSnapshot(snapshot, {
  now = () => Date.now(),
  ttlMs = MARKET_SNAPSHOT_ATTESTATION_TTL_MS
} = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('MARKET_SNAPSHOT_ATTESTATION_INVALID_SNAPSHOT');
  }
  if (!snapshot.authoritativeFreshness?.serverDerived) {
    throw new Error('MARKET_SNAPSHOT_ATTESTATION_REQUIRES_SERVER_FRESHNESS');
  }
  if (ttlMs !== MARKET_SNAPSHOT_ATTESTATION_TTL_MS) {
    throw new Error('MARKET_SNAPSHOT_ATTESTATION_TTL_FROZEN');
  }

  const nowMs = now();
  purgeExpired(nowMs);
  const id = randomUUID();
  registry.set(id, Object.freeze({
    version: MARKET_SNAPSHOT_ATTESTATION_VERSION,
    fingerprint: fingerprint(snapshot),
    authoritativeFreshness: snapshot.authoritativeFreshness,
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs
  }));

  return Object.freeze({
    id,
    version: MARKET_SNAPSHOT_ATTESTATION_VERSION,
    expiresAt: new Date(nowMs + ttlMs).toISOString()
  });
}

export function resolveMarketSnapshotAttestation(snapshot, {
  now = () => Date.now()
} = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return Object.freeze({ ok: false, blocker: 'SNAPSHOT_ATTESTATION_INVALID_SNAPSHOT' });
  }
  const id = typeof snapshot.snapshotAttestationId === 'string'
    ? snapshot.snapshotAttestationId.trim()
    : '';
  if (!id) return Object.freeze({ ok: false, blocker: 'SNAPSHOT_ATTESTATION_REQUIRED' });

  const nowMs = now();
  purgeExpired(nowMs);
  const record = registry.get(id);
  if (!record) return Object.freeze({ ok: false, blocker: 'SNAPSHOT_ATTESTATION_MISSING_OR_EXPIRED' });
  if (record.expiresAtMs <= nowMs) {
    registry.delete(id);
    return Object.freeze({ ok: false, blocker: 'SNAPSHOT_ATTESTATION_EXPIRED' });
  }
  if (fingerprint(snapshot) !== record.fingerprint) {
    return Object.freeze({ ok: false, blocker: 'SNAPSHOT_ATTESTATION_FINGERPRINT_MISMATCH' });
  }

  return Object.freeze({
    ok: true,
    blocker: null,
    authoritativeFreshness: record.authoritativeFreshness,
    version: record.version,
    expiresAt: new Date(record.expiresAtMs).toISOString()
  });
}

export function clearMarketSnapshotAttestationsForTest() {
  registry.clear();
}
