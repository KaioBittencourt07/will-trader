const MAX_ATTEMPTS = 2;

function validExitCode(value) {
  return Number.isInteger(value) && value >= -1 && value <= 255;
}

/**
 * Pure decision gate for a future repair runner. It does not execute tests,
 * inspect diffs, revert files, or change repository state.
 */
export function evaluateRepairCandidate({
  workspaceGuard,
  attemptNumber,
  baseline,
  candidate,
  previousAttempts = 0
} = {}) {
  const reasons = [];
  if (workspaceGuard?.allowed !== true) reasons.push('WORKSPACE_GUARD_DENIED');
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1 || attemptNumber > MAX_ATTEMPTS) {
    reasons.push('ATTEMPT_LIMIT_EXCEEDED');
  }
  if (!Number.isInteger(previousAttempts) || previousAttempts < 0 ||
      previousAttempts >= MAX_ATTEMPTS || attemptNumber !== previousAttempts + 1) {
    reasons.push('ATTEMPT_SEQUENCE_INVALID');
  }
  if (!baseline || !validExitCode(baseline.exitCode) || baseline.exitCode === 0 ||
      typeof baseline.command !== 'string' || baseline.command.trim().length === 0) {
    reasons.push('BASELINE_FAILURE_NOT_PROVEN');
  }
  if (!candidate || !validExitCode(candidate.exitCode)) reasons.push('CANDIDATE_RESULT_INVALID');
  else if (candidate.exitCode !== 0) reasons.push('CANDIDATE_CHECKS_FAILED');
  if (candidate?.requiredChecksPassed !== true) reasons.push('REQUIRED_CHECKS_NOT_CONFIRMED');
  if (candidate?.diffReviewed !== true) reasons.push('DIFF_REVIEW_NOT_CONFIRMED');
  if (candidate?.secretsDetected === true) reasons.push('SECRET_DETECTED');
  if (candidate?.testsWeakened === true) reasons.push('TESTS_WEAKENED');
  if (!Array.isArray(candidate?.changedPaths) || candidate.changedPaths.length === 0) {
    reasons.push('CHANGED_PATHS_MISSING');
  } else if (candidate.changedPaths.length > 30) {
    reasons.push('CHANGED_PATH_LIMIT_EXCEEDED');
  }
  if (candidate?.changedPaths?.some((path) => typeof path !== 'string' ||
      !(path.startsWith('backend/src/engineering/') || path.startsWith('docs/engineering/')) ||
      path.includes('..') || path.startsWith('/') || path.includes('\\'))) {
    reasons.push('CHANGED_PATH_OUTSIDE_ALLOWLIST');
  }

  const uniqueReasons = [...new Set(reasons)];
  const accepted = uniqueReasons.length === 0;
  const exhausted = attemptNumber === MAX_ATTEMPTS && !accepted;
  return Object.freeze({
    policyVersion: 'will-repair-candidate-gate-v1',
    decision: accepted ? 'CANDIDATE_ELIGIBLE_FOR_HUMAN_REVIEW'
      : exhausted ? 'STOP_AND_REPORT' : 'REJECT_CANDIDATE',
    accepted,
    reasons: Object.freeze(uniqueReasons),
    attemptNumber: Number.isInteger(attemptNumber) ? attemptNumber : null,
    maxAttempts: MAX_ATTEMPTS,
    effects: Object.freeze({
      filesWritten: 0,
      candidateReverted: false,
      commandsExecuted: 0,
      networkRequests: 0,
      brokerCalls: 0
    }),
    limitation: 'Decision only; a separate isolated runner must execute checks and discard rejected candidates.'
  });
}
