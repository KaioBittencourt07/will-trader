import assert from 'node:assert/strict';
import test from 'node:test';
import { runBoundedRepairCycle } from './repairCycle.js';

function makeAdapter(overrides = {}) {
  const calls = [];
  return Object.assign({
    calls,
    async inspectRepository() {
      calls.push('inspect');
      return { branch: 'feat/autonomous-engineering-agent-v1', baselineCommit: 'a'.repeat(40), worktreeStatus: 'CLEAN', changedFiles: [] };
    },
    async reproduceBaseline() { calls.push('baseline'); return { command: 'node --test example.test.js', exitCode: 1, output: 'assertion failed' }; },
    async createIsolatedWorkspace({ attemptNumber }) { calls.push('create:' + attemptNumber); return { id: attemptNumber }; },
    async proposePatch() { calls.push('propose'); return { changedPaths: ['backend/src/engineering/fix.js'] }; },
    async applyPatch() { calls.push('apply'); },
    async runRequiredChecks() { calls.push('checks'); return { exitCode: 0, requiredChecksPassed: true, output: 'passed' }; },
    async inspectDiff() { calls.push('diff'); return { changedPaths: ['backend/src/engineering/fix.js'], diffReviewed: true, secretsDetected: false, testsWeakened: false }; },
    async discardWorkspace({ workspace }) { calls.push('discard:' + workspace.id); },
    async retainForHumanReview({ workspace }) { calls.push('retain:' + workspace.id); }
  }, overrides);
}
const scope = ['backend/src/engineering/fix.js'];

test('verified candidate is retained for human review only', async () => {
  const adapter = makeAdapter();
  const result = await runBoundedRepairCycle({ adapter, requestedPaths: scope });
  assert.equal(result.decision, 'CANDIDATE_ELIGIBLE_FOR_HUMAN_REVIEW');
  assert.equal(result.acceptedAttempt, 1);
  assert.ok(adapter.calls.includes('retain:1'));
  assert.equal(result.effects.autonomousMerge, false);
  assert.equal(result.effects.deployment, false);
  assert.equal(result.effects.brokerCalls, 0);
});

test('guard denial prevents baseline and patch execution', async () => {
  const adapter = makeAdapter({ async inspectRepository() {
    return { branch: 'main', baselineCommit: 'a'.repeat(40), worktreeStatus: 'DIRTY', changedFiles: [] };
  }});
  const result = await runBoundedRepairCycle({ adapter, requestedPaths: scope });
  assert.equal(result.decision, 'BLOCKED_WORKSPACE_GUARD');
  assert.ok(!adapter.calls.includes('baseline'));
  assert.ok(!adapter.calls.includes('apply'));
});

test('no patch is attempted when baseline failure cannot be reproduced', async () => {
  const adapter = makeAdapter({ async reproduceBaseline() {
    return { command: 'node --test', exitCode: 0, output: 'passed' };
  }});
  const result = await runBoundedRepairCycle({ adapter, requestedPaths: scope });
  assert.equal(result.decision, 'NO_REPRODUCIBLE_FAILURE');
  assert.ok(!adapter.calls.includes('apply'));
});

test('failed checks are discarded and attempts are capped at two', async () => {
  const adapter = makeAdapter({ async runRequiredChecks() {
    return { exitCode: 1, requiredChecksPassed: false, output: 'failed' };
  }});
  const result = await runBoundedRepairCycle({ adapter, requestedPaths: scope });
  assert.equal(result.decision, 'STOP_AND_REPORT');
  assert.equal(result.rejectedAttempts.length, 2);
  assert.ok(adapter.calls.includes('discard:1'));
  assert.ok(adapter.calls.includes('discard:2'));
  assert.equal(adapter.calls.filter((call) => call.startsWith('create:')).length, 2);
});

test('protected paths are rejected before patch application', async () => {
  const adapter = makeAdapter({ async proposePatch() {
    return { changedPaths: ['data/research.json'] };
  }});
  const result = await runBoundedRepairCycle({ adapter, requestedPaths: scope });
  assert.equal(result.decision, 'STOP_AND_REPORT');
  assert.ok(!adapter.calls.includes('apply'));
  assert.ok(adapter.calls.includes('discard:1'));
});

test('diff path mismatch is discarded even when the proposed patch path was allowed', async () => {
  const adapter = makeAdapter({
    async inspectDiff() {
      this.calls.push('diff-mismatch');
      return {
        changedPaths: ['docs/engineering/unreported-change.md'],
        diffReviewed: true,
        secretsDetected: false,
        testsWeakened: false
      };
    }
  });
  const result = await runBoundedRepairCycle({ adapter, requestedPaths: scope });
  assert.equal(result.decision, 'STOP_AND_REPORT');
  assert.equal(result.rejectedAttempts[0].reasons[0], 'PATCH_DIFF_PATH_MISMATCH');
  assert.ok(adapter.calls.includes('discard:1'));
  assert.ok(!adapter.calls.includes('retain:1'));
});

test('adapter errors are contained and active workspace is discarded', async () => {
  const adapter = makeAdapter({ async runRequiredChecks() { throw new Error('adapter failed'); }});
  const result = await runBoundedRepairCycle({ adapter, requestedPaths: scope });
  assert.equal(result.decision, 'STOP_AND_REPORT_ERROR');
  assert.ok(adapter.calls.includes('discard:1'));
});

test('incomplete adapter is blocked', async () => {
  const result = await runBoundedRepairCycle({ adapter: {}, requestedPaths: scope });
  assert.equal(result.decision, 'BLOCKED_ADAPTER_INCOMPLETE');
});
