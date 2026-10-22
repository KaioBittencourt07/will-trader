import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { once } from 'node:events';
import analyzeRouter from './analyze.js';

test('POST /api/analyze blocks a fresh-looking client snapshot without server attestation, even when client disables the guard', async (t) => {
  const persisted = [];
  const app = express();
  app.use(express.json());
  app.locals.prospectiveManifest = { version: 'test-only' };
  app.locals.historyStore = {
    recordDecision(record) {
      persisted.push(record);
      return { id: 'analyze-attestation-test', status: 'SKIPPED', idempotent: false };
    }
  };
  app.use('/api', analyzeRouter);

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      market: {
        asset: 'EUR/USD',
        timeframe: '1min',
        price: 1.17,
        timestamp: new Date().toISOString(),
        source: 'client-supplied'
      },
      context: {
        requireAuthoritativeFreshness: false,
        decisionId: 'client-attempted-bypass'
      }
    })
  });

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.source, 'snapshot-attestation-guard');
  assert.equal(body.decision.direction, 'WAIT');
  assert.equal(body.decision.executable, false);
  assert.equal(body.decision.blocked, true);
  assert.ok(body.decision.blockReasons.includes('SNAPSHOT_ATTESTATION_REQUIRED'));
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].decision.direction, 'WAIT');
});
