import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { once } from 'node:events';
import marketRouter from './market.js';

test('market status remains available and explicitly unconfigured without a provider key', async (t) => {
  const previousKey = process.env.TWELVEDATA_API_KEY;
  process.env.TWELVEDATA_API_KEY = '';

  const app = express();
  app.locals.twelveWebSocketFeed = {
    health: () => ({
      mode: 'SHADOW_OBSERVABILITY',
      state: 'DISABLED',
      enabled: false,
      decisionImpact: 'NONE'
    })
  };
  app.use('/api', marketRouter);

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (previousKey === undefined) delete process.env.TWELVEDATA_API_KEY;
    else process.env.TWELVEDATA_API_KEY = previousKey;
  });

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/market/status`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.direct.state, 'UNCONFIGURED');
  assert.equal(body.providerReadiness.ready, false);
  assert.equal(body.providerReadiness.reasonCode, 'TWELVEDATA_API_KEY_NOT_CONFIGURED');
  assert.equal(body.webSocketShadow.decisionImpact, 'NONE');
});
