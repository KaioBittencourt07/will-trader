export const EVIDENCE_ADMISSION_VERSION = 'evidence-admission-v1';

const INVALID_STATUSES = new Set(['STALE', 'MARKET_CLOSED', 'DATA_INVALID', 'INVALID']);
const TECHNICAL_BLOCK = /^(DATA_QUALITY_|Dados atrasados\.|AUTHORITATIVE_FRESHNESS_|TIMESTAMP_AUTHORITY_|MARKET_AGE_|EVENT_OLDER_THAN_FROZEN_CONTRACT|MARKET_ADMISSION_REJECTED|SERVER_SNAPSHOT_ATTESTATION_)/;

export function evaluateEvidenceAdmission(record = {}, { requireMarketAdmission = true } = {}) {
  const reasons = [];
  const quality = record.metadata?.dataQuality ?? {};
  const blockReasons = Array.isArray(record.metadata?.blockReasons) ? record.metadata.blockReasons : [];
  const admission = record.metadata?.context?.marketAdmission ?? record.metadata?.marketAdmission ?? null;
  const qualityStatus = String(quality.status ?? '').toUpperCase();

  if (quality.valid === false) reasons.push('DATA_QUALITY_INVALID');
  if (INVALID_STATUSES.has(qualityStatus)) reasons.push(`DATA_STATUS_${qualityStatus}`);
  if (blockReasons.some((reason) => TECHNICAL_BLOCK.test(String(reason)))) reasons.push('TECHNICAL_BLOCK_PRESENT');

  if (admission?.state === 'REJECTED') reasons.push('MARKET_ADMISSION_REJECTED');
  if (requireMarketAdmission && admission?.state !== 'ADMITTED') reasons.push('MARKET_ADMISSION_PROOF_REQUIRED');

  const eligible = reasons.length === 0;

  return Object.freeze({
    version: EVIDENCE_ADMISSION_VERSION,
    eligible,
    state: eligible ? 'EVIDENCE_ADMITTED' : 'EVIDENCE_REJECTED',
    admissionVersion: admission?.version ?? null,
    admissionState: admission?.state ?? null,
    reasons: Object.freeze([...new Set(reasons)])
  });
}

export function isValidEvidenceRecord(record = {}, options = {}) {
  return evaluateEvidenceAdmission(record, options).eligible;
}
