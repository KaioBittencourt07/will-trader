import assert from 'node:assert/strict';
import test from 'node:test';
import { createTwelveDataProvider } from '../data/src/providers/twelveDataProvider.js';

function response(body) { return { ok: true, json: async () => body }; }

test('Twelve Data batch creates one independent snapshot per returned symbol', async () => {
  const now = Math.floor(Date.now() / 1000);
  const candle = (close) => Array.from({ length: 12 }, (_, index) => ({ close: String(close + index * 0.01), datetime: new Date(Date.now() - (11 - index) * 60_000).toISOString().slice(0, 19).replace('T', ' ') }));
  const provider = createTwelveDataProvider({
    apiKey: 'test',
    fetchImpl: async (url) => String(url).includes('/quote?')
      ? response({ 'EUR/USD': { close: '1.2', timestamp: now }, 'BTC/USD': { close: '100', timestamp: now } })
      : response({ 'EUR/USD': { values: candle(1) }, 'BTC/USD': { values: candle(100) } })
  });
  const results = await provider.getSnapshots(['EUR/USD', 'BTC/USD'], '1min', 12);
  assert.equal(results.length, 2);
  assert.equal(results[0].snapshot.asset, 'EUR/USD');
  assert.equal(results[1].snapshot.asset, 'BTC/USD');
});
