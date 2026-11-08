import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const backend = path.resolve(process.cwd(), 'backend');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth(url, child) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error('WILL backend exited before becoming healthy');
    try {
      const response = await fetch(url + '/health');
      if (response.ok) return response.json();
    } catch {}
    await delay(100);
  }
  throw new Error('WILL backend health endpoint did not become ready');
}

test('Avalon relay requires a secret, accepts only validated read-only events and exposes shadow status', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'will-avalon-relay-'));
  const port = 45_000 + (process.pid % 1_000);
  const url = 'http://127.0.0.1:' + port;
  const token = 'test-only-avalon-relay-token';
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: backend,
    env: {
      ...process.env,
      PORT: String(port),
      WILL_HISTORY_FILE: path.join(directory, 'history.json'),
      WILL_PAPER_MONITOR_STATE_FILE: path.join(directory, 'monitor.json'),
      WILL_PAPER_MONITOR_ENABLED: 'false',
      WILL_TWELVE_WS_ENABLED: 'false',
      WILL_COINBASE_TEMPORAL_ENABLED: 'false',
      WILL_BIQUOTE_FOREX_ENABLED: 'false',
      TWELVEDATA_API_KEY: '',
      WILL_AVALON_RELAY_TOKEN: token,
      DASHBOARD_ORIGIN: 'https://kaiobittencourt07.github.io'
    },
    stdio: 'ignore'
  });

  try {
    const health = await waitForHealth(url, child);
    assert.equal(health.avalonRelayEnabled, true);
    assert.equal(health.avalonReadOnly.mode, 'SHADOW_ONLY');
    assert.equal(health.avalonReadOnly.state, 'WAITING');

    const unauthorized = await fetch(url + '/api/avalon/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: { name: 'timeSync', msg: Date.now() } })
    });
    assert.equal(unauthorized.status, 401);

    const accepted = await fetch(url + '/api/avalon/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-will-relay-token': token },
      body: JSON.stringify({
        event: {
          name: 'candle-generated',
          msg: {
            active_id: 1857, size: 60, id: 7,
            at: 1_794_153_600_000_000_000, from: 1_794_153_540_000_000_000, to: 1_794_153_600_000_000_000,
            open: 1.08, max: 1.081, min: 1.079, close: 1.0805,
            bid: 1.0804, ask: 1.0806, volume: 2, phase: 'active'
          }
        }
      })
    });
    assert.equal(accepted.status, 202);
    assert.equal((await accepted.json()).accepted, true);

    const status = await fetch(url + '/api/avalon/status').then((response) => response.json());
    assert.equal(status.health.state, 'RECEIVING');
    assert.deepEqual(status.health.activeIds, [1857]);
    assert.equal(status.health.decisionImpact, 'NONE');
    assert.equal(status.health.ordersExecuted, 0);

    const invalid = await fetch(url + '/api/avalon/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-will-relay-token': token },
      body: JSON.stringify({
        event: { name: 'candle-generated', msg: { active_id: 1858, open: 1, max: .5, min: .4, close: 1, bid: 1, ask: 1.1 } }
      })
    });
    assert.equal(invalid.status, 422);

    const preflight = await fetch(url + '/api/avalon/ingest', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://trade.avalonbroker.com',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-will-relay-token',
        'access-control-request-private-network': 'true'
      }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://trade.avalonbroker.com');
    assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');
  } finally {
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
    if (child.exitCode === null) {
      await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(3000)]);
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
