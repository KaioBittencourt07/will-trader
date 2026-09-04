import assert from 'node:assert/strict';
import test from 'node:test';
import { createHttpMarketProvider } from '../data/src/providers/httpProvider.js';

test('HTTP provider normalizes provider response', async () => {
  const now = new Date().toISOString();
  const provider = createHttpMarketProvider({ url: 'https://example.invalid/market', fetchImpl: async () => ({ ok: true, json: async () => ({ asset: 'EUR/USD', timeframe: '1m', price: 1.17, timestamp: now }) }) });
  const result = await provider.getSnapshot('EUR/USD', '1m');
  assert.equal(result.valid, true);
  assert.equal(result.asset, 'EUR/USD');
});

test('HTTP provider surfaces upstream failure', async () => {
  const provider = createHttpMarketProvider({ url: 'https://example.invalid/market', fetchImpl: async () => ({ ok: false, status: 503 }) });
  await assert.rejects(() => provider.getSnapshot('EUR/USD', '1m'), /HTTP 503/);
});
