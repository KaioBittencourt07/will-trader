import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateRepairCandidate } from './repairCandidateGate.js';

const guard = { allowed: true };
const baseline = { command: 'node --test src/example.test.js', exitCode: 1 };
const candidate = {
  exitCode: 0,
  requiredChecksPassed: true,
  diffReviewed: true,
  secretsDetected: false,
  testsWeakened: false,
  changedPaths: ['backend/src/engineering/example.js']
};
const input = { workspaceGuard: guard, attemptNumber: 1, previousAttempts: 0, baseline, candidate };

test('eligible candidate requires reproducible baseline failure and all gates', () => {
  const result = evaluateRepairCandidate(input);
  assert.equal(result.accepted, true);
  assert.equal(result.decision, 'CANDIDATE_ELIGIBLE_FOR_HUMAN_REVIEW');
  assert.deepEqual(result.reasons, []);
  assert.equal(result.effects.candidateReverted, false);
});

test('rejects missing or passing baseline and failed candidate checks', () => {
  assert.ok(evaluateRepairCandidate({ ...input, baseline: { command: 'test', exitCode: 0 } }).reasons.includes('BASELINE_FAILURE_NOT_PROVEN'));
  assert.ok(evaluateRepairCandidate({ ...input, candidate: { ...candidate, exitCode: 1 } }).reasons.includes('CANDIDATE_CHECKS_FAILED'));
});

test('rejects weak review, secret findings, weakened tests, and paths outside scope', () => {
  for (const patch of [
    { diffReviewed: false },
    { secretsDetected: true },
    { testsWeakened: true },
    { changedPaths: ['backend/src/server.js'] },
    { changedPaths: ['backend/src/engineering/../../data/results.json'] }
  ]) {
    const result = evaluateRepairCandidate({ ...input, candidate: { ...candidate, ...patch } });
    assert.equal(result.accepted, false);
  }
});

test('enforces exactly sequential attempts and stops after the bounded second attempt', () => {
  assert.ok(evaluateRepairCandidate({ ...input, attemptNumber: 2, previousAttempts: 0 }).reasons.includes('ATTEMPT_SEQUENCE_INVALID'));
  const result = evaluateRepairCandidate({
    ...input, attemptNumber: 2, previousAttempts: 1,
    candidate: { ...candidate, exitCode: 1 }
  });
  assert.equal(result.decision, 'STOP_AND_REPORT');
  assert.ok(result.reasons.includes('CANDIDATE_CHECKS_FAILED'));
});

test('denied workspace and unconfirmed required checks never pass', () => {
  assert.equal(evaluateRepairCandidate({ ...input, workspaceGuard: { allowed: false } }).accepted, false);
  assert.equal(evaluateRepairCandidate({ ...input, candidate: { ...candidate, requiredChecksPassed: false } }).accepted, false);
});
