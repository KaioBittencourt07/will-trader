import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateWorkspaceGuard } from './workspaceGuard.js';

const base = {
  branch: 'feat/autonomous-engineering-agent-v1',
  baselineCommit: 'a'.repeat(40),
  worktreeStatus: 'CLEAN',
  changedFiles: ['backend/src/engineering/readOnlyDiagnostics.js'],
  requestedPaths: ['backend/src/engineering/workspaceGuard.js']
};

test('allows only clean, isolated, allowlisted engineering changes', () => {
  const result = evaluateWorkspaceGuard(base);
  assert.equal(result.allowed, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.policyVersion, 'will-workspace-guard-v1');
  assert.deepEqual(result.effects, {
    filesWritten: 0, commandsExecuted: 0, networkRequests: 0, brokerCalls: 0
  });
});

test('fails closed on protected branches, invalid baseline, or dirty/unknown worktree', () => {
  for (const patch of [
    { branch: 'main' },
    { baselineCommit: 'not-a-commit' },
    { worktreeStatus: 'DIRTY' },
    { worktreeStatus: 'UNKNOWN' }
  ]) {
    const result = evaluateWorkspaceGuard({ ...base, ...patch });
    assert.equal(result.allowed, false);
  }
});

test('rejects traversal, absolute paths, Windows paths, and protected data paths', () => {
  for (const path of [
    '../data/frozen-results.json',
    '/tmp/patch.js',
    'backend\\src\\engineering\\patch.js',
    'backend/src/engineering/../../data/frozen-results.json',
    'backend/src/engineering/.env',
    'data/research-results.json',
    'backend/src/server.js'
  ]) {
    const result = evaluateWorkspaceGuard({ ...base, requestedPaths: [path] });
    assert.equal(result.allowed, false, path);
  }
});

test('rejects missing scope, malformed path lists, and oversized plans', () => {
  assert.equal(evaluateWorkspaceGuard({ ...base, requestedPaths: [] }).allowed, false);
  assert.equal(evaluateWorkspaceGuard({ ...base, requestedPaths: 'backend/src/engineering/x.js' }).allowed, false);
  assert.equal(evaluateWorkspaceGuard({
    ...base, requestedPaths: Array.from({ length: 31 }, (_, i) => `backend/src/engineering/file${i}.js`)
  }).allowed, false);
});

test('deduplicates policy reasons and never performs side effects', () => {
  const result = evaluateWorkspaceGuard({ ...base, branch: 'main', worktreeStatus: 'DIRTY' });
  assert.equal(new Set(result.reasons).size, result.reasons.length);
  assert.equal(result.effects.filesWritten, 0);
  assert.equal(result.effects.brokerCalls, 0);
});
