import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { once } from 'node:events';
import marketRouter, { parseMarketOutputsize, parseMarketTimeframe, parseMarketTimeframes } from '../backend/src/routes/market.js';

test('defaults missing market outputsize to 50', () => {
  assert.deepEqual(parseMarketOutputsize(undefined), { value: 50 });
});

test('clamps integer outputsize to route-specific bounds', () => {
  assert.deepEqual(parseMarketOutputsize('1', 12), { value: 12 });
  assert.deepEqual(parseMarketOutputsize('500', 20), { value: 200 });
  assert.deepEqual(parseMarketOutputsize('75', 12), { value: 75 });
});

test('rejects malformed outputsize instead of passing NaN to market providers', () => {
  for (const value of ['abc', '1.5', '-2', 'Infinity', '1e3', '9007199254740992']) {
    assert.deepEqual(parseMarketOutputsize(value), { error: 'MARKET_OUTPUTSIZE_INVALID' }, value);
  }
});

test('accepts zero as an integer and clamps it to the minimum', () => {
  assert.deepEqual(parseMarketOutputsize('0', 12), { value: 12 });
});


test('defaults missing or blank multi-timeframe input to the standard three periods', () => {
  assert.deepEqual(parseMarketTimeframes(undefined), { value: ['1min', '5min', '15min'] });
  assert.deepEqual(parseMarketTimeframes(''), { value: ['1min', '5min', '15min'] });
  assert.deepEqual(parseMarketTimeframes('   '), { value: ['1min', '5min', '15min'] });
});

test('normalizes and accepts up to three supported unique timeframes', () => {
  assert.deepEqual(parseMarketTimeframes(' 1MIN, 5min,15MIN '), { value: ['1min', '5min', '15min'] });
  assert.deepEqual(parseMarketTimeframes('1h,4h,1day'), { value: ['1h', '4h', '1day'] });
});

test('rejects empty entries, unsupported periods, duplicates, and more than three periods', () => {
  for (const value of [',,,', '1min,,5min', '0min', '2min', '1min,1MIN', '1min,5min,15min,30min']) {
    assert.deepEqual(parseMarketTimeframes(value), { error: 'MARKET_TIMEFRAMES_INVALID' }, value);
  }
});

  
test('defaults a missing or blank single timeframe to 1min and normalizes supported values', () => {
  assert.deepEqual(parseMarketTimeframe(undefined), { value: '1min' });
  assert.deepEqual(parseMarketTimeframe('  '), { value: '1min' });
  assert.deepEqual(parseMarketTimeframe(' 15MIN '), { value: '15min' });
  assert.deepEqual(parseMarketTimeframe('1day'), { value: '1day' });
  assert.deepEqual(parseMarketTimeframe('8h'), { value: '8h' });
});

test('rejects unsupported single timeframe values before provider access', () => {
  for (const value of ['2min', '0min', '1m', 'forever']) {
    assert.deepEqual(parseMarketTimeframe(value), { error: 'MARKET_TIMEFRAME_INVALID' }, value);
  }
});


test('invalid market query parameters return HTTP 400 before any provider access', async (t) => {
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
