import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAutonomousPaperMonitor, sanitizeCycleError } from '../learning/src/autonomousPaperMonitor.js';

function stateFile() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'will-monitor-'));
  return { directory, filePath: path.join(directory, 'state.json') };
}

test('monitor uses deterministic cadence IDs, durable restart deduplication and no execution capability', async () => {
  const { directory, filePath } = stateFile();
  try {
    const calls = [];
    const monitor = createAutonomousPaperMonitor({ enabled: true, filePath, intervalMs: 60_000, now: () => 120_001, runCycle: async (input) => { calls.push(input); return { ok: true }; } });
    assert.equal((await monitor.runOnce()).status, 'COMPLETED');
    assert.deepEqual(calls[0], { cycleId: 'autonomous-paper-monitor-v1:2', mode: 'PAPER' });
    const restarted = createAutonomousPaperMonitor({ enabled: true, filePath, intervalMs: 60_000, now: () => 120_001, runCycle: async () => { throw new Error('must not run'); } });
    assert.equal((await restarted.runOnce()).status, 'IDEMPOTENT');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('monitor prevents overlap and fails closed on provider/data failures', async () => {
  const { directory, filePath } = stateFile();
  try {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const monitor = createAutonomousPaperMonitor({ enabled: true, filePath, now: () => 60_001, runCycle: async () => pending });
    const first = monitor.runOnce();
    assert.equal((await monitor.runOnce()).status, 'OVERLAP_SKIPPED');
    release({ ok: false, reason: 'PROVIDER_DEGRADED' });
    assert.equal((await first).status, 'SKIPPED_INVALID_CYCLE');
    assert.equal((await monitor.runOnce()).status, 'IDEMPOTENT');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('monitor rejects unsafe cadence and pauses without durable state', async () => {
  assert.throws(() => createAutonomousPaperMonitor({ intervalMs: 59_999, runCycle: async () => ({ ok: true }) }), /MONITOR_INTERVAL_MIN/);
  const monitor = createAutonomousPaperMonitor({ enabled: true, filePath: null, runCycle: async () => ({ ok: true }) });
  assert.equal((await monitor.runOnce()).reason, 'DURABLE_STATE_UNAVAILABLE');
});

test('cycle exceptions stay idempotent and expose only bounded redacted diagnostics', async () => {
  const { directory, filePath } = stateFile();
  try {
    const events = [];
    const monitor = createAutonomousPaperMonitor({
      enabled: true,
      filePath,
      now: () => 180_001,
      onEvent: (event) => events.push(event),
      logger: (event) => events.push({ logged: event }),
      runCycle: async () => {
        const error = new Error('upstream failed Authorization: Bearer top-secret api_key=very-secret https://user:pass@example.test/x?token=hidden');
        error.code = 'EACCES';
        throw error;
      }
    });
    const failed = await monitor.runOnce();
    assert.equal(failed.status, 'SKIPPED_INVALID_CYCLE');
    assert.equal(failed.reason, 'CYCLE_FAILURE');
    assert.equal(failed.ran, false);
    assert.equal(failed.errorCode, 'NETWORK_EACCES');
    assert.match(failed.errorDetail, /REDACTED/);
    assert.doesNotMatch(JSON.stringify(events), /top-secret|very-secret|user:pass|hidden/);
    assert.equal('decision' in failed, false);
    assert.equal('quote' in failed, false);
    assert.equal('outcome' in failed, false);
    assert.equal((await monitor.runOnce()).status, 'IDEMPOTENT');
    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')).completedCycleIds, [failed.cycleId]);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('storage failure remains paused without creating a synthetic observation', async () => {
  const { directory } = stateFile();
  try {
    const fileParent = path.join(directory, 'not-a-directory');
    fs.writeFileSync(fileParent, 'x');
    const monitor = createAutonomousPaperMonitor({ enabled: true, filePath: path.join(fileParent, 'state.json'), now: () => 240_001, runCycle: async () => { throw new Error('secret=not-persisted'); } });
    const event = await monitor.runOnce();
    assert.deepEqual(event, {
      ran: false,
      status: 'PAUSED',
      reason: 'STORAGE_FAILURE',
      cycleId: 'autonomous-paper-monitor-v1:4',
      mode: 'PAPER',
      emittedAt: event.emittedAt
    });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('error sanitizer is deterministic, short and omits stacks', () => {
  const error = new Error(`token ${'a'.repeat(500)}`);
  error.status = 503;
  error.stack = 'sensitive stack';
  const diagnostic = sanitizeCycleError(error);
  assert.equal(diagnostic.errorCode, 'HTTP_503');
  assert.ok(diagnostic.errorDetail.length <= 240);
  assert.doesNotMatch(diagnostic.errorDetail, /sensitive stack/);
});

