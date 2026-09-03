import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAutonomousPaperMonitor } from '../learning/src/autonomousPaperMonitor.js';

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

