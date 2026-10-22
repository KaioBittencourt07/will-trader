import { evaluateWorkspaceGuard } from './workspaceGuard.js';
import { evaluateRepairCandidate } from './repairCandidateGate.js';
import { redactDiagnosticText } from './readOnlyDiagnostics.js';

const MAX_ATTEMPTS = 2;
const SAFE_SHA = /^[a-f0-9]{7,64}$/i;

/**
 * Dependency-injected repair coordinator.
 *
 * All side effects are delegated to an adapter that MUST provide isolated,
 * disposable workspaces. This module never runs shell commands, edits files,
 * contacts networks, or calls a broker directly.
 *
 * Adapter contract:
 * - inspectRepository() -> { branch, baselineCommit, worktreeStatus, changedFiles }
 * - reproduceBaseline({ baselineCommit }) -> { command, exitCode, output }
 * - createIsolatedWorkspace({ baselineCommit, attemptNumber }) -> workspace handle
 * - proposePatch({ workspace, baseline, attemptNumber, previousRejections }) -> patch descriptor
 * - applyPatch({ workspace, patch }) -> void
 * - runRequiredChecks({ workspace }) -> { exitCode, output, requiredChecksPassed }
 * - inspectDiff({ workspace }) -> { changedPaths, diffReviewed, secretsDetected, testsWeakened }
 * - discardWorkspace({ workspace }) -> void
 * - retainForHumanReview({ workspace, report }) -> void
 *
 * This coordinator only declares a candidate eligible for human review. It
 * never merges, deploys, or authorizes a broker action.
 */
export async function runBoundedRepairCycle({
  adapter,
  requestedPaths,
  issue = 'Unspecified engineering issue'
} = {}) {
  const events = [];
  const rejectedAttempts = [];
  let activeWorkspace = null;
  let retained = false;
  const startedAt = new Date().toISOString();

  const report = (decision, extra = {}) => Object.freeze({
    schemaVersion: 'will-bounded-repair-cycle-v1',
    issue: redactDiagnosticText(issue, 240),
    startedAt,
    completedAt: new Date().toISOString(),
    decision,
    attempts: rejectedAttempts.length + (extra.acceptedAttempt ? 1 : 0),
    maxAttempts: MAX_ATTEMPTS,
    events: Object.freeze([...events]),
    rejectedAttempts: Object.freeze([...rejectedAttempts]),
    effects: Object.freeze({
      autonomousMerge: false,
      deployment: false,
      brokerCalls: 0,
      networkRequestsByCoordinator: 0
    }),
    ...extra
  });

  const requiredMethods = [
    'inspectRepository', 'reproduceBaseline', 'createIsolatedWorkspace',
    'proposePatch', 'applyPatch', 'runRequiredChecks', 'inspectDiff',
    'discardWorkspace', 'retainForHumanReview'
  ];
  if (!adapter || requiredMethods.some((name) => typeof adapter[name] !== 'function')) {
    return report('BLOCKED_ADAPTER_INCOMPLETE', {
      reasons: Object.freeze(['REQUIRED_ADAPTER_METHOD_MISSING'])
    });
  }

  try {
    const repository = await adapter.inspectRepository();
    if (!repository || typeof repository !== 'object') {
      return report('BLOCKED_REPOSITORY_METADATA_INVALID', {
        reasons: Object.freeze(['REPOSITORY_METADATA_INVALID'])
      });
    }
    const { branch, baselineCommit, worktreeStatus, changedFiles = [] } = repository;
    const guard = evaluateWorkspaceGuard({
      branch, baselineCommit, worktreeStatus, changedFiles,
      requestedPaths: Array.isArray(requestedPaths) ? requestedPaths : []
    });
    if (!guard.allowed) {
      events.push('workspace_guard_denied');
      return report('BLOCKED_WORKSPACE_GUARD', {
        branch: typeof branch === 'string' ? branch : null,
        baselineCommit: typeof baselineCommit === 'string' && SAFE_SHA.test(baselineCommit) ? baselineCommit : null,
        reasons: guard.reasons
      });
    }
    events.push('workspace_guard_passed');

    const baseline = await adapter.reproduceBaseline({ baselineCommit });
    if (!baseline || !Number.isInteger(baseline.exitCode) || baseline.exitCode < -1 || baseline.exitCode > 255) {
      return report('BLOCKED_BASELINE_RESULT_INVALID', {
        baseline: Object.freeze({ command: null, exitCode: null, output: '' }),
        reasons: Object.freeze(['BASELINE_RESULT_INVALID'])
      });
    }
    const safeBaseline = Object.freeze({
      command: redactDiagnosticText(baseline.command ?? '', 500),
      exitCode: baseline.exitCode,
      output: redactDiagnosticText(baseline.output ?? '', 4000)
    });
    events.push('baseline_reproduced');
    if (baseline.exitCode === 0) {
      return report('NO_REPRODUCIBLE_FAILURE', {
        baseline: safeBaseline,
        reasons: Object.freeze(['BASELINE_DID_NOT_FAIL'])
      });
    }

    for (let attemptNumber = 1; attemptNumber <= MAX_ATTEMPTS; attemptNumber++) {
      activeWorkspace = await adapter.createIsolatedWorkspace({ baselineCommit, attemptNumber });
      if (!activeWorkspace) {
        rejectedAttempts.push(Object.freeze({ attemptNumber, reasons: Object.freeze(['ISOLATED_WORKSPACE_NOT_CREATED']) }));
        events.push('workspace_creation_failed');
        continue;
      }
      events.push('isolated_workspace_created');

      const patch = await adapter.proposePatch({
        workspace: activeWorkspace,
        baseline: safeBaseline,
        attemptNumber,
        previousRejections: Object.freeze([...rejectedAttempts])
      });
      if (!patch || !Array.isArray(patch.changedPaths) || patch.changedPaths.length === 0) {
        rejectedAttempts.push(Object.freeze({ attemptNumber, reasons: Object.freeze(['PATCH_SCOPE_MISSING']) }));
        await adapter.discardWorkspace({ workspace: activeWorkspace });
        activeWorkspace = null;
        events.push('patch_scope_rejected');
        continue;
      }

      const patchGuard = evaluateWorkspaceGuard({
        branch, baselineCommit, worktreeStatus: 'CLEAN',
        changedFiles: patch.changedPaths,
        requestedPaths: patch.changedPaths
      });
      if (!patchGuard.allowed) {
        rejectedAttempts.push(Object.freeze({
          attemptNumber,
          reasons: Object.freeze(['PATCH_SCOPE_REJECTED', ...patchGuard.reasons])
        }));
        await adapter.discardWorkspace({ workspace: activeWorkspace });
        activeWorkspace = null;
        events.push('patch_scope_rejected');
        continue;
      }

      await adapter.applyPatch({ workspace: activeWorkspace, patch });
      events.push('patch_applied_in_isolation');
      const checks = await adapter.runRequiredChecks({ workspace: activeWorkspace });
      const diff = await adapter.inspectDiff({ workspace: activeWorkspace });
      const proposedPaths = [...patch.changedPaths].sort();
      const inspectedPaths = Array.isArray(diff?.changedPaths) ? [...diff.changedPaths].sort() : null;
      if (!inspectedPaths || proposedPaths.length !== inspectedPaths.length ||
          proposedPaths.some((path, index) => path !== inspectedPaths[index])) {
        rejectedAttempts.push(Object.freeze({
          attemptNumber,
          reasons: Object.freeze(['PATCH_DIFF_PATH_MISMATCH']),
          output: redactDiagnosticText(checks?.output ?? '', 2000)
        }));
        await adapter.discardWorkspace({ workspace: activeWorkspace });
        activeWorkspace = null;
        events.push('candidate_rejected_diff_scope_mismatch');
        continue;
      }
      const gate = evaluateRepairCandidate({
        workspaceGuard: patchGuard,
        attemptNumber,
        previousAttempts: attemptNumber - 1,
        baseline: safeBaseline,
        candidate: {
          exitCode: checks?.exitCode,
          requiredChecksPassed: checks?.requiredChecksPassed === true && checks?.exitCode === 0,
          diffReviewed: diff?.diffReviewed === true,
          secretsDetected: diff?.secretsDetected === true,
          testsWeakened: diff?.testsWeakened === true,
          changedPaths: diff?.changedPaths
        }
      });
      if (gate.accepted) {
        const safeReport = report('CANDIDATE_ELIGIBLE_FOR_HUMAN_REVIEW', {
          acceptedAttempt: attemptNumber,
          branch,
          baselineCommit,
          baseline: safeBaseline,
          changedPaths: Object.freeze([...diff.changedPaths]),
          verification: Object.freeze({
            exitCode: checks.exitCode,
            requiredChecksPassed: checks.requiredChecksPassed === true,
            diffReviewed: diff.diffReviewed === true,
            secretsDetected: diff.secretsDetected === true,
            testsWeakened: diff.testsWeakened === true
          }),
          reasons: Object.freeze([])
        });
        await adapter.retainForHumanReview({ workspace: activeWorkspace, report: safeReport });
        retained = true;
        activeWorkspace = null;
        events.push('candidate_retained_for_human_review');
        return safeReport;
      }

      rejectedAttempts.push(Object.freeze({
        attemptNumber,
        reasons: gate.reasons,
        output: redactDiagnosticText(checks?.output ?? '', 2000)
      }));
      await adapter.discardWorkspace({ workspace: activeWorkspace });
      activeWorkspace = null;
      events.push('candidate_rejected_and_discarded');
    }

    return report('STOP_AND_REPORT', {
      branch,
      baselineCommit,
      baseline: safeBaseline,
      reasons: Object.freeze(['ATTEMPT_BUDGET_EXHAUSTED_OR_NO_SAFE_CANDIDATE'])
    });
  } catch (error) {
    events.push('adapter_error');
    if (activeWorkspace && !retained) {
      try {
        await adapter.discardWorkspace({ workspace: activeWorkspace });
        events.push('workspace_discarded_after_error');
      } catch {
        events.push('workspace_discard_failed');
      }
    }
    return report('STOP_AND_REPORT_ERROR', {
      reasons: Object.freeze(['REPAIR_CYCLE_ADAPTER_ERROR']),
      error: redactDiagnosticText(error instanceof Error ? error.message : String(error), 1000)
    });
  }
}
