import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateAnalyzeTemporalAdmission } from '../backend/src/analyzeTemporalAdmission.js';

test('legacy compatibility remains allowed when authoritative freshness is not required', () => {
  const result = evaluateAnalyzeTemporalAdmission({}, {});
  assert.equal(result.allowed, true);
  assert.equal(result.mode, 'LEGACY_COMPATIBILITY');
});

test('required mode blocks when authoritative freshness is missing', () => {
  const result = evaluateAnalyzeTemporalAdmission({}, { requireAuthoritativeFreshness: true });
  assert.equal(result.allowed, false);
  assert.equal(result.blocker, 'AUTHORITATIVE_FRESHNESS_MISSING');
});

test('required mode blocks failed timestamp authority', () => {
  const result = evaluateAnalyzeTemporalAdmission({ authoritativeFreshness: { authorityGate: 'FAIL', freshnessGate: 'UNVERIFIED' } }, { requireAuthoritativeFreshness: true });
  assert.equal(result.allowed, false);
  assert.equal(result.blocker, 'TIMESTAMP_AUTHORITY_NOT_APPROVED');
});

test('required mode blocks failed freshness even with authority pass', () => {
  const result = evaluateAnalyzeTemporalAdmission({ authoritativeFreshness: { authorityGate: 'PASS', freshnessGate: 'FAIL' } }, { requireAuthoritativeFreshness: true });
  assert.equal(result.allowed, false);
  assert.equal(result.blocker, 'AUTHORITATIVE_FRESHNESS_NOT_APPROVED');
});

test('required mode allows analysis only when authority and freshness both pass', () => {
  const result = evaluateAnalyzeTemporalAdmission({ authoritativeFreshness: { authorityGate: 'PASS', freshnessGate: 'PASS' } }, { requireAuthoritativeFreshness: true });
  assert.equal(result.allowed, true);
  assert.equal(result.decisionImpact, 'ALLOW_ANALYSIS_ONLY');
});
