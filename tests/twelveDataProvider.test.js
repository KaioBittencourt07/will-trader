import assert from 'node:assert/strict';
import test from 'node:test';
import { createTwelveDataProvider } from '../data/src/providers/twelveDataProvider.js';

function mockFetch(url) {
  const body = url.includes('/quote?')
    ? { close: '1.1700', timestamp: Math.floor(Date.now() / 1000) }
    : { values: Array.from({ length: 20 }, (_, i) => ({ datetime: new Date(Date.now() - (19 - i) * 60_000).toISOString(), open: String(1.16 + i * 0.0005), high: String(1.161 + i * 0.0005), low: String(1.159 + i * 0.0005), close: String(1.16 + i * 0.0005) })) };
  return Promise.resolve({ ok: true, json: async () => body });
}

test('builds a valid market snapshot from quote and candles', async () => {
  const provider = createTwelveDataProvider({ apiKey: 'test', fetchImpl: mockFetch });
  const result = await provider.getSnapshot('EUR/USD', '1min', 20);
  assert.equal(result.valid, true);
  assert.equal(result.source, 'twelvedata');
  assert.equal(result.candleCount, 20);
  assert.equal(typeof result.trend, 'number');
  assert.equal(typeof result.momentum, 'number');
  assert.equal(typeof result.structure, 'number');
  assert.equal(typeof result.volatility, 'number');
});

test('captures only safe rate-limit timing evidence from provider headers', async () => {
  const headers = new Map([['retry-after', '7'], ['x-ratelimit-reset', '2000000000']]);
  const provider = createTwelveDataProvider({
    apiKey: 'test',
    fetchImpl: async () => ({ ok: false, status: 429, headers: { get: (name) => headers.get(name) ?? null } })
  });
  await assert.rejects(() => provider.getSnapshot('EUR/USD'), (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterMs, 7_000);
    assert.equal(error.rateLimitResetAt, '2033-05-18T03:33:20.000Z');
    assert.deepEqual(error.rateLimitEvidence, { httpStatus: 429, retryAfterProvided: true, resetProvided: true });
    assert.equal(JSON.stringify(error).includes('test'), false);
    return true;
  });
});
