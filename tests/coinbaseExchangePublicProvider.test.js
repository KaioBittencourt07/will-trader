import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoinbaseExchangePublicProvider, coinbasePublicProductFor } from '../data/src/providers/coinbaseExchangePublicProvider.js';

function fixtures(nowMs = Date.now(), ageMs = 700) {
  const quoteMs = nowMs - ageMs;
  const latestClosedOpen = Math.floor(quoteMs / 60_000) * 60_000 - 60_000;
  const candles = Array.from({ length: 35 }, (_, index) => {
    const openMs = latestClosedOpen - index * 60_000;
    const close = 100 + (34 - index) * 0.05;
    return [Math.floor(openMs / 1_000), String(close - 0.02), String(close + 0.04), String(close - 0.01), String(close), '12.5'];
  });
  return { ticker: { price: '101.45', time: new Date(quoteMs).toISOString() }, candles };
}
function response(body, status = 200, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: (name) => headers[name.toLowerCase()] ?? null }, json: async () => body };
}

test('maps only explicitly qualified Coinbase USD spot products', () => {
  assert.equal(coinbasePublicProductFor('BTC/USD'), 'BTC-USD');
  assert.equal(coinbasePublicProductFor('XRP/USD'), 'XRP-USD');
  assert.equal(coinbasePublicProductFor('BTC/USDT'), null);
  assert.equal(coinbasePublicProductFor('../../ticker'), null);
});

test('builds a timestamp-qualified snapshot from last-trade time and closed OHLC candles', async () => {
  const nowMs = Date.now();
  const data = fixtures(nowMs);
  const calls = [];
  const provider = createCoinbaseExchangePublicProvider({
    now: () => nowMs,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return response(String(url).endsWith('/ticker') ? data.ticker : data.candles);
    }
  });
  const snapshot = await provider.getSnapshot('BTC/USD', '1min', 20);
  assert.equal(snapshot.valid, true);
  assert.equal(snapshot.status, 'OK');
  assert.equal(snapshot.source, 'coinbase-exchange-rest');
  assert.equal(snapshot.marketVenue, 'COINBASE_EXCHANGE');
  assert.equal(snapshot.quoteCurrency, 'USD');
  assert.equal(snapshot.candleCompleteness, 'VERIFIED_CLOSED_BY_COINBASE_EVENT_TIME');
  assert.equal(snapshot.candleCount, 20);
  assert.equal(snapshot.timestampOrigins.quoteTimestampField, 'ticker.time');
  assert.ok(snapshot.candles.every((bar) => Date.parse(bar.datetime) + 60_000 <= Date.parse(snapshot.quoteTimestamp)));
  assert.equal(calls.length, 2);
  assert.ok(calls.every((item) => item.options.headers.Authorization === undefined));
  assert.ok(calls.every((item) => item.url.startsWith('https://api.exchange.coinbase.com/products/BTC-USD/')));
});

test('rejects unsupported product/timeframe before network access', async () => {
  let calls = 0;
  const provider = createCoinbaseExchangePublicProvider({ fetchImpl: async () => { calls++; return response({}); } });
  await assert.rejects(() => provider.getSnapshot('DOGE/USD'), /COINBASE_PUBLIC_SYMBOL_UNSUPPORTED/);
  await assert.rejects(() => provider.getSnapshot('BTC/USD', '2min'), /COINBASE_PUBLIC_TIMEFRAME_UNSUPPORTED/);
  assert.equal(calls, 0);
});

test('preserves rate-limit evidence and does not turn provider errors into prices', async () => {
  const provider = createCoinbaseExchangePublicProvider({
    fetchImpl: async () => response({ message: 'rate limited' }, 429, { 'retry-after': '3' })
  });
  await assert.rejects(() => provider.getSnapshot('BTC/USD'), (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterMs, 3_000);
    assert.equal(error.code, 'COINBASE_PUBLIC_RATE_LIMITED');
    return true;
  });
});

test('rejects malformed OHLC and exposes stale quotes as non-admissible', async () => {
  const nowMs = Date.now();
  const malformed = fixtures(nowMs);
  malformed.candles[0] = [Math.floor(nowMs / 60_000) * 60, 'not-a-price', '2', '1', '1.5', '4'];
  const bad = createCoinbaseExchangePublicProvider({
    now: () => nowMs,
    fetchImpl: async (url) => response(String(url).endsWith('/ticker') ? malformed.ticker : malformed.candles)
  });
  await assert.rejects(() => bad.getSnapshot('BTC/USD'), /PUBLIC_CRYPTO_CANDLE_INVALID/);

  const staleData = fixtures(nowMs, 60_000);
  const stale = createCoinbaseExchangePublicProvider({
    now: () => nowMs, maxAgeMs: 5_000,
    fetchImpl: async (url) => response(String(url).endsWith('/ticker') ? staleData.ticker : staleData.candles)
  });
  const snapshot = await stale.getSnapshot('BTC/USD');
  assert.equal(snapshot.valid, false);
  assert.equal(snapshot.status, 'STALE');
});
