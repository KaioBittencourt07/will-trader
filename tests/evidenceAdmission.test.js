import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEvidenceAdmission } from '../backend/src/evidenceAdmission.js';

function record(overrides = {}) {
  return {
    metadata: {
      dataQuality: { valid: true, status: 'OK' },
      blockReasons: [],
      context: {
        marketAdmission: {
          version: 'market-admission-gate-v1',
          state: 'ADMITTED'
        }
      }
    },
    ...overrides
  };
}

test('admits only records with explicit market admission proof', () => {
  const result = evaluateEvidenceAdmission(record());
  assert.equal(result.eligible, true);
  assert.equal(result.state, 'EVIDENCE_ADMITTED');
});

test('rejects legacy records that lack admission proof', () => {
  const candidate = record();
  delete candidate.metadata.context.marketAdmission;
  const result = evaluateEvidenceAdmission(candidate);
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes('MARKET_ADMISSION_PROOF_REQUIRED'));
});

test('rejects technical temporal blockers even if admission marker exists', () => {
  const candidate = record();
  candidate.metadata.blockReasons = ['TIMESTAMP_AUTHORITY_NOT_APPROVED'];
  const result = evaluateEvidenceAdmission(candidate);
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes('TECHNICAL_BLOCK_PRESENT'));
});

test('rejects invalid quality and explicit rejected admission', () => {
  const candidate = record();
  candidate.metadata.dataQuality = { valid: false, status: 'STALE' };
  candidate.metadata.context.marketAdmission.state = 'REJECTED';
  const result = evaluateEvidenceAdmission(candidate);
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes('DATA_QUALITY_INVALID'));
  assert.ok(result.reasons.includes('MARKET_ADMISSION_REJECTED'));
});
