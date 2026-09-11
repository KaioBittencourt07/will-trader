import assert from 'node:assert/strict';
import test from 'node:test';
import { createTwelveDataProvider } from '../data/src/providers/twelveDataProvider.js';

function seriesBody(nowMs = Date.now()) {
  return { values: Array.from({ length: 20 }, (_, i) => ({ datetime: new Date(nowMs - (19 - i) * 60_000).toISOString(), open: String(1.16 + i * 0.0005), high: String(1.161 + i * 0.0005), low: String(1.159 + i * 0.0005), close: String(1.16 + i * 0.0005) })) };
}

function mockFetch(url) {
  const body = url.includes('/quote?')
    ? { close: '1.1700', timestamp: Math.floor(Date.now() / 1000) }
    : seriesBody();
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

test('preserves exact timestamp provenance when quote timestamp is used', async () => {
  const nowMs = 2_000_000_000_000;
  const provider = createTwelveDataProvider({
    apiKey: 'test', now: () => nowMs,
    fetchImpl: async (url) => ({ ok: true, json: async () => url.includes('/quote?')
      ? { close: '1.1700', timestamp: Math.floor((nowMs - 5_000) / 1000) }
      : seriesBody(nowMs) })
  });
  const result = await provider.getSnapshot('EUR/USD', '1min', 20);
  assert.equal(result.timestampOrigins.quoteTimestamp, 'twelvedata.quote.timestamp');
  assert.equal(result.timestampOrigins.quoteTimestampField, 'timestamp');
  assert.equal(result.freshnessBasis, 'REST_QUOTE_TIMESTAMP');
});

test('prefers and preserves last_update_at when last_quote_at is absent', async () => {
  const nowMs = 2_000_000_000_000;
  const provider = createTwelveDataProvider({
    apiKey: 'test', now: () => nowMs,
    fetchImpl: async (url) => ({ ok: true, json: async () => url.includes('/quote?')
      ? { close: '1.1700', last_update_at: Math.floor((nowMs - 4_000) / 1000), timestamp: Math.floor((nowMs - 60_000) / 1000) }
      : seriesBody(nowMs) })
  });
  const result = await provider.getSnapshot('EUR/USD', '1min', 20);
  assert.equal(result.timestampOrigins.quoteTimestamp, 'twelvedata.quote.last_update_at');
  assert.equal(result.timestampOrigins.quoteTimestampField, 'last_update_at');
  assert.equal(result.freshnessBasis, 'REST_QUOTE_LAST_UPDATE_AT');
});

test('prefers and preserves last_quote_at over other quote timestamp fields', async () => {
  const nowMs = 2_000_000_000_000;
  const provider = createTwelveDataProvider({
    apiKey: 'test', now: () => nowMs,
    fetchImpl: async (url) => ({ ok: true, json: async () => url.includes('/quote?')
      ? { close: '1.1700', last_quote_at: Math.floor((nowMs - 3_000) / 1000), last_update_at: Math.floor((nowMs - 4_000) / 1000), timestamp: Math.floor((nowMs - 60_000) / 1000) }
      : seriesBody(nowMs) })
  });
  const result = await provider.getSnapshot('EUR/USD', '1min', 20);
  assert.equal(result.timestampOrigins.quoteTimestamp, 'twelvedata.quote.last_quote_at');
  assert.equal(result.timestampOrigins.quoteTimestampField, 'last_quote_at');
  assert.equal(result.freshnessBasis, 'REST_QUOTE_LAST_QUOTE_AT');
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
