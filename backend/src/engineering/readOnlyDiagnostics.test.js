import assert from 'node:assert/strict';
import test from 'node:test';
import { createReadOnlyDiagnosticReport, redactDiagnosticText } from './readOnlyDiagnostics.js';

test('redacts secret assignments, bearer tokens, API-key-shaped values and URL query secrets', () => {
  const input = 'api_key=super-secret authorization: Bearer abc.def.token https://example.test/?token=private&mode=1 sk-1234567890abcdefghijkl';
  const output = redactDiagnosticText(input);
  assert.doesNotMatch(output, /super-secret|abc\.def\.token|token=private|sk-1234567890abcdefghijkl/);
  assert.match(output, /\[REDACTED\]/);
});

test('diagnostic reports classify failures while retaining bounded, redacted evidence', () => {
  const report = createReadOnlyDiagnosticReport({
    issue: 'Provider quota reached',
    baselineCommit: 'a'.repeat(40),
    branch: 'feat/diagnostics',
    worktreeStatus: 'CLEAN',
    command: 'npm test -- token=do-not-print',
    exitCode: 1,
    error: Object.assign(new Error('HTTP 429 api_key=secret-value'), { code: 'PROVIDER_RATE_LIMITED' }),
    output: 'Retry-After=60 Authorization: Bearer private-token'
  });
  assert.equal(report.schemaVersion, 'will-read-only-diagnostic-v1');
  assert.equal(report.mode, 'READ_ONLY');
  assert.equal(report.classification.category, 'PROVIDER_RATE_LIMIT');
  assert.equal(report.classification.severity, 'MEDIUM');
  assert.equal(report.baselineCommit, 'a'.repeat(40));
  assert.equal(report.worktreeStatus, 'CLEAN');
  assert.equal(report.exitCode, 1);
  assert.doesNotMatch(JSON.stringify(report), /secret-value|private-token|do-not-print/);
  assert.equal(report.patchCreated, false);
  assert.equal(report.filesWritten, 0);
  assert.equal(report.networkRequests, 0);
  assert.equal(report.brokerCalls, 0);
});

test('invalid metadata is downgraded to safe unknown values', () => {
  const report = createReadOnlyDiagnosticReport({
    baselineCommit: 'not-a-sha',
    branch: 'feature branch; token=secret',
    worktreeStatus: 'TRUST_ME',
    exitCode: 999,
    observedAt: 'not-a-date',
    error: Object.assign(new Error('SyntaxError: invalid source'), { code: 'not a safe code' })
  });
  assert.equal(report.baselineCommit, null);
  assert.equal(report.worktreeStatus, 'UNKNOWN');
  assert.equal(report.exitCode, null);
  assert.equal(report.observedAt, null);
  assert.equal(report.error.code, null);
  assert.equal(report.classification.category, 'RUNTIME_OR_DEPENDENCY');
  assert.doesNotMatch(JSON.stringify(report), /secret/);
});

test('output is truncated and unknown issues do not receive high confidence', () => {
  const report = createReadOnlyDiagnosticReport({ output: 'x'.repeat(5000), error: 'unexpected behavior' });
  assert.ok(report.output.length < 4_100);
  assert.match(report.output, /TRUNCATED/);
  assert.equal(report.classification.category, 'UNKNOWN');
  assert.ok(report.classification.confidence < 0.5);
  assert.deepEqual(report.actionsTaken, []);
});
