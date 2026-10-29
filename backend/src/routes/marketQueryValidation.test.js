import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { once } from 'node:events';
import marketRouter from './market.js';

test('invalid market query parameters return HTTP 400 before provider access', async (t) => {
  const app = express();
  app.use('/api', marketRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => new Promise((resolve) => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const cases = [
    ['/api/market?timeframe=2min', 'MARKET_TIMEFRAME_INVALID'],
    ['/api/market/diagnostic?timeframe=2min', 'MARKET_TIMEFRAME_INVALID'],
    ['/api/market/multi?timeframes=,,,', 'MARKET_TIMEFRAMES_INVALID'],
    ['/api/market?outputsize=abc', 'MARKET_OUTPUTSIZE_INVALID']
  ];

  for (const [path, expectedError] of cases) {
    const response = await fetch(`${baseUrl}${path}`);
    const body = await response.json();
    assert.equal(response.status, 400, path);
    assert.equal(body.error, expectedError, path);
  }
});
