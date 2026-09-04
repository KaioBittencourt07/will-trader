import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve('.');
const backend = path.join(root, 'backend');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth(url, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch {}
    if (child.exitCode !== null) throw new Error('Backend encerrou antes do health check.');
    await delay(25);
  }
  throw new Error('Backend não iniciou no tempo esperado.');
}

test('POST /api/analyze persists WAIT durably and deduplicates a stable decisionId', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'will-analyze-history-'));
  const port = 43_000 + (process.pid % 1_000);
  const url = `http://127.0.0.1:${port}`;
  const historyFile = path.join(directory, 'history.json');
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: backend,
    env: {
      ...process.env,
      PORT: String(port),
      WILL_HISTORY_FILE: historyFile,
      WILL_PAPER_MONITOR_STATE_FILE: path.join(directory, 'monitor.json'),
      WILL_PAPER_MONITOR_ENABLED: 'false',
      TWELVEDATA_API_KEY: ''
    },
    stdio: 'ignore'
  });
  try {
    await waitForHealth(url, child);
    const payload = {
      market: { asset: 'CONTRACT_INVALID', timeframe: '1min', timestamp: 'invalid', price: 0 },
      context: { decisionId: 'analyze-history-contract:1' }
    };
    const request = () => fetch(`${url}/api/analyze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }).then((response) => response.json());
    const first = await request();
    const second = await request();
    assert.equal(first.decision.direction, 'WAIT');
    assert.equal(first.history.status, 'SKIPPED');
    assert.equal(typeof first.history.id, 'string');
    assert.equal(second.history.id, first.history.id);
    assert.equal(second.history.idempotent, true);
    const history = await fetch(`${url}/api/history?limit=10`).then((response) => response.json());
    assert.equal(history.total, 1);
    assert.equal(history.records[0].direction, 'WAIT');
    assert.equal(history.records[0].decisionId, 'analyze-history-contract:1');
    assert.equal(JSON.parse(fs.readFileSync(historyFile, 'utf8')).length, 1);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

