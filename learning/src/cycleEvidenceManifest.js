import { createHash } from 'node:crypto';

export const MANIFEST_VERSION = 'paper-cycle-evidence-manifest-v1';
export const MONITOR_VERSION = 'autonomous-paper-monitor-v1';
export const MEMBERSHIP_FIELDS = Object.freeze(['protocolId', 'campaignId', 'cycleId', 'writerGeneration']);
export function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  throw new Error('INVALID_CANONICAL_VALUE');
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
export const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && /T.*Z$/.test(value);
export function canonicalDigest(manifest) {
  return digest({ schemaVersion: manifest.schemaVersion, protocolId: manifest.protocolId,
    campaignId: manifest.campaignId, cycleId: manifest.cycleId, writerGeneration: manifest.writerGeneration,
    expectedRecordCount: manifest.expectedRecordCount, recordIds: [...manifest.recordIds].sort() });
}
export function newManifest({ protocolId, campaignId, cycleId, writerGeneration, openedAt }) {
  if (![protocolId,campaignId,cycleId].every(validId) || !cycleId.startsWith(`${MONITOR_VERSION}:`) ||
    !Number.isSafeInteger(writerGeneration) || writerGeneration < 1 || !validTime(openedAt)) throw new Error('INVALID_CYCLE_IDENTITY');
  const manifest = { schemaVersion: MANIFEST_VERSION, protocolId, campaignId, monitorVersion: MONITOR_VERSION,
    cycleId, openedAt, writerGeneration, inventoryRevision: 0, sealSequence: null,
    expectedRecordCount: 0, recordIds: [], canonicalDigest: null, sealedAt: null, state: 'OPEN' };
  manifest.canonicalDigest = canonicalDigest(manifest);
  return manifest;
}
const fields = Object.keys(newManifest({protocolId:'p',campaignId:'c',cycleId:`${MONITOR_VERSION}:x`,writerGeneration:1,openedAt:'2000-01-01T00:00:00.000Z'})).sort();
export function validateManifest(m) {
  if (!m || canonical(Object.keys(m).sort()) !== canonical(fields)) throw new Error('INVALID_MANIFEST_SHAPE');
  newManifest(m);
  if (m.schemaVersion !== MANIFEST_VERSION || m.monitorVersion !== MONITOR_VERSION ||
    !['OPEN','SEALED','INVALID'].includes(m.state) || !Array.isArray(m.recordIds) || !m.recordIds.every(validId) ||
    new Set(m.recordIds).size !== m.recordIds.length || m.expectedRecordCount !== m.recordIds.length ||
    !Number.isSafeInteger(m.inventoryRevision) || m.inventoryRevision !== m.expectedRecordCount ||
    m.canonicalDigest !== canonicalDigest(m)) throw new Error('INVALID_MANIFEST_INTEGRITY');
  if (m.state === 'SEALED' && (!validTime(m.sealedAt) || !Number.isSafeInteger(m.sealSequence) || m.sealSequence < 1)) throw new Error('INVALID_SEAL');
  if (m.state === 'OPEN' && (m.sealSequence !== null || m.sealedAt !== null)) throw new Error('INVALID_SEAL');
  return m;
}
export function sameMembership(record, manifest) {
  return MEMBERSHIP_FIELDS.every(key => record?.[key] === manifest[key]);
}
export function verifyManifestAgainstHistory(manifest, history) {
  const reasons = [];
  try { validateManifest(manifest); } catch { return { valid: false, complete: false, reasons: ['MANIFEST_INVALID'] }; }
  if (!Array.isArray(history)) return { valid: false, complete: false, reasons: ['HISTORY_INVALID'] };
  const rows = history.filter(r => r?.cycleId === manifest.cycleId || r?.metadata?.context?.monitorCycleId === manifest.cycleId);
  const ids = rows.map(r => r.id), inventory = new Set(manifest.recordIds);
  if (new Set(ids).size !== ids.length) reasons.push('DUPLICATE_RECORD');
  if (manifest.recordIds.some(id => !ids.includes(id))) reasons.push('MISSING_RECORD');
  if (ids.some(id => !inventory.has(id))) reasons.push('EXTRA_RECORD');
  if (rows.some(r => !sameMembership(r, manifest))) reasons.push('MEMBERSHIP_MISMATCH');
  if (manifest.state !== 'SEALED') reasons.push('NOT_SEALED');
  const valid = reasons.length === 0;
  // Terminal state only: no result-label aggregation or performance evaluation.
  if (rows.some(r => r.status !== 'CLOSED' || !validTime(r.settledAt))) reasons.push('PENDING_RECORD');
  return { valid, complete: reasons.length === 0, reasons };
}
