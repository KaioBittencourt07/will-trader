import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runPaperMonitorCycle } from '../backend/src/paperMonitorCycle.js';
import { createAutonomousPaperMonitor } from '../learning/src/autonomousPaperMonitor.js';

const validTimeout = Object.freeze({ valid: true, status: 'MONITOR_TIMEOUT_CONFIG_VALID', timeoutMs: 55_000, maximumMs: 59_000 });

test('monitor cycle applies the same configured timeout to diagnostic and opportunity requests', async () => {
  const requests = [];
  const result = await runPaperMonitorCycle({
    baseUrl: 'http://127.0.0.1:3102', cycleId: 'cycle-1', timeout: validTimeout,
    abortSignalFactory: (timeoutMs) => ({ timeoutMs }),
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), timeoutMs: options.signal.timeoutMs });
      return { ok: true, json: async () => String(url).includes('/diagnostic')
        ? { ok: true, diagnostic: { status: 'HEALTHY' }, providerEfficiency: { externalRequests: 2, cacheMisses: 1, externalLatencyMs: 12, creditsEstimated: 2 } }
        : { ok: true, scanned: 1, recommendation: { asset: 'EUR/USD' }, providerEfficiency: { cacheHits: 1 } } };
    }
  });
  assert.deepEqual(requests.map((request) => request.timeoutMs), [55_000, 55_000]);
  assert.match(requests[1].url, /monitorCycleId=cycle-1/);
  assert.deepEqual(result, {
    ok: true, status: null, scanned: 1, recommendation: 'EUR/USD',
    providerEfficiency: {
      version: 'provider-efficiency-v1', scope: 'paper-monitor-cycle', externalRequests: 2,
      cacheHits: 1, cacheMisses: 1, deduplicated: 0, limiterWaitMs: 0,
      externalLatencyMs: 12, creditsEstimated: 2, creditsEstimatedIsOfficial: false
    }
  });
});

test('invalid timeout config does not issue a request or create a recommendation', async () => {
  let calls = 0;
  const result = await runPaperMonitorCycle({
    baseUrl: 'http://127.0.0.1:3102', cycleId: 'cycle-1', timeout: { valid: false, status: 'MONITOR_TIMEOUT_CONFIG_INVALID' },
    fetchImpl: async () => { calls += 1; throw new Error('must not fetch'); }
  });
  assert.equal(calls, 0);
  assert.deepEqual(result, { ok: false, status: 'MONITOR_TIMEOUT_CONFIG_INVALID', scanned: 0, recommendation: null });
});

test('a timeout remains a fail-closed idempotent monitor failure with no synthetic decision', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'will-timeout-monitor-'));
  const filePath = path.join(directory, 'state.json');
  try {
    const monitor = createAutonomousPaperMonitor({
      enabled: true, filePath, now: () => 300_001,
      runCycle: () => runPaperMonitorCycle({
        baseUrl: 'http://127.0.0.1:3102', cycleId: 'cycle-5', timeout: { ...validTimeout, timeoutMs: 1 },
        abortSignalFactory: () => {
          const controller = new AbortController();
          queueMicrotask(() => controller.abort());
          return controller.signal;
        },
        fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => {
          const error = new Error('The operation was aborted due to timeout');
          error.name = 'TimeoutError';
          reject(error);
        }))
      })
    });
    const event = await monitor.runOnce();
    assert.equal(event.status, 'SKIPPED_INVALID_CYCLE');
    assert.equal(event.ran, false);
    assert.equal(event.errorCode, 'REQUEST_TIMEOUT');
    assert.equal('decision' in event, false);
    assert.equal((await monitor.runOnce()).status, 'IDEMPOTENT');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

