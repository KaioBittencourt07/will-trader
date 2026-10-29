import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { once } from 'node:events';
import marketRouter from './market.js';

test('market sources reports unverified states without probing external providers', async (t) => {
  const previousKey = process.env.TWELVEDATA_API_KEY;
  process.env.TWELVEDATA_API_KEY = '';

  const app = express();
  app.locals.twelveWebSocketFeed = {
    health: () => ({
      mode: 'SHADOW_OBSERVABILITY',
      state: 'DISABLED',
      enabled: false,
      connected: false,
      available: false,
      configuredSymbols: 1,
      successfulConnections: 0,
      messagesReceived: 0,
      symbols: []
    })
  };
  app.locals.coinbaseTemporalFeeds = new Map([
    ['BTC/USD', { health: () => ({
      mode: 'TEMPORAL_AUTHORITY_ONLY',
      state: 'DISABLED',
      enabled: false,
      running: false,
      ready: false,
      messagesReceived: 0,
      acceptedObservations: 0,
      reconnects: 0,
      decisionImpact: 'NONE',
      ordersExecuted: 0
    }) }]
  ]);
  app.locals.biquoteForexFeed = {
    health: () => ({
      mode: 'READ_ONLY_CONTINUOUS_CACHED_POLLING',
      state: 'DISABLED',
      enabled: false,
      running: false,
      requestsMade: 0,
      successfulPolls: 0,
      failedPolls: 0,
      assets: {},
      automatedBrokerExecution: false,
      ordersExecuted: 0
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

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/market/sources`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.mode, 'READ_ONLY_STATUS_NO_UPSTREAM_PROBES');
  assert.match(body.checkedAt, /^\\d{4}-\\d{2}-\\d{2}T/);

  const byId = Object.fromEntries(body.sources.map((source) => [source.id, source]));
  assert.equal(byId['twelvedata-rest'].state, 'UNCONFIGURED');
  assert.equal(byId['twelvedata-rest'].probePerformed, false);
  assert.equal(byId['twelvedata-websocket'].state, 'DISABLED');
  assert.equal(byId['twelvedata-websocket'].connected, false);
  assert.equal(byId['coinbase-temporal:BTC/USD'].state, 'DISABLED');
  assert.equal(byId['coinbase-temporal:BTC/USD'].connected, false);
  assert.equal(byId['binance'].state, 'IMPLEMENTED_NOT_PROBED');
  assert.equal(byId['binance'].connected, false);
  assert.equal(byId['avalon'].state, 'NOT_CONNECTED');
  assert.equal(byId['avalon'].connected, false);
  assert.ok(body.sources.every((source) => source.probePerformed === false || source.id === 'coinbase-temporal:BTC/USD'));
  assert.ok(body.sources.every((source) => source.ordersExecuted === undefined || source.ordersExecuted === 0));
});

test('connected Twelve Data websocket without fresh ticks is not reported as available', async (t) => {
  const previousKey = process.env.TWELVEDATA_API_KEY;
  process.env.TWELVEDATA_API_KEY = '';

  const app = express();
  app.locals.twelveWebSocketFeed = {
    health: () => ({
      mode: 'SHADOW_OBSERVABILITY',
      state: 'CONNECTED',
      enabled: true,
      connected: true,
      available: false,
      configuredSymbols: 1,
      successfulConnections: 1,
      messagesReceived: 0,
      lastTickAgeMs: null,
      symbols: [{ symbol: 'EUR/USD', fresh: false }]
    })
  };
  app.locals.coinbaseTemporalFeeds = new Map();
  app.locals.biquoteForexFeed = { health: () => ({ state: 'DISABLED', enabled: false, running: false, requestsMade: 0, assets: {} }) };
  app.use('/api', marketRouter);

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (previousKey === undefined) delete process.env.TWELVEDATA_API_KEY;
    else process.env.TWELVEDATA_API_KEY = previousKey;
  });

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/market/sources`);
  const body = await response.json();
  const websocket = body.sources.find((source) => source.id === 'twelvedata-websocket');
  assert.equal(response.status, 200);
  assert.equal(websocket.state, 'CONNECTED_WITHOUT_FRESH_TICKS');
  assert.equal(websocket.connected, true);
  assert.equal(websocket.available, false);
  assert.equal(websocket.freshSymbols, 0);
});
