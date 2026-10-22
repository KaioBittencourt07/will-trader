import assert from 'node:assert/strict';
import test from 'node:test';
import { createBinanceSpotPublicProvider, binancePublicSymbolFor } from '../data/src/providers/binanceSpotPublicProvider.js';

function fixtures(nowMs = Date.now(), ageMs = 700) {
  const quoteMs = nowMs - ageMs;
  const latestClosedOpen = Math.floor(quoteMs / 60_000) * 60_000 - 60_000;
  const candles = Array.from({ length: 35 }, (_, index) => {
    const openMs = latestClosedOpen - index * 60_000;
    const close = 60_000 + (34 - index) * 12;
    return [openMs, String(close - 4), String(close + 10), String(close - 1), String(close), '1.25', openMs + 59_999, '75000', 200, '0.75', '45000', '0'];
  });
  return {
    trade: [{ id: 42, price: '60348.2', qty: '0.01', time: quoteMs, isBuyerMaker: false, isBestMatch: true }],
    candles
  };
}
function response(body, status = 200, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: (name) => headers[name.toLowerCase()] ?? null }, json: async () => body };
}

test('maps explicit USDT pairs and does not relabel them as USD', () => {
  assert.equal(binancePublicSymbolFor('BTC/USDT'), 'BTCUSDT');
  assert.equal(binancePublicSymbolFor('ADA/USDT'), 'ADAUSDT');
  assert.equal(binancePublicSymbolFor('BTC/USD'), null);
});

test('uses latest trade event time and closed klines without credentials', async () => {
  const nowMs = Date.now();
  const data = fixtures(nowMs);
  const calls = [];
  const provider = createBinanceSpotPublicProvider({
    now: () => nowMs,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return response(String(url).includes('/api/v3/trades?') ? data.trade : data.candles);
    }
  });
  const snapshot = await provider.getSnapshot('BTC/USDT', '1min', 20);
  assert.equal(snapshot.valid, true);
  assert.equal(snapshot.status, 'OK');
  assert.equal(snapshot.source, 'binance-spot-rest');
  assert.equal(snapshot.marketVenue, 'BINANCE_SPOT');
  assert.equal(snapshot.quoteCurrency, 'USDT');
  assert.equal(snapshot.candleCompleteness, 'VERIFIED_CLOSED_BY_BINANCE_EVENT_TIME');
  assert.equal(snapshot.candleCount, 20);
  assert.equal(snapshot.timestampOrigins.quoteTimestampField, 'trades[0].time');
  assert.ok(snapshot.candles.every((bar) => Date.parse(bar.datetime) + 60_000 <= Date.parse(snapshot.quoteTimestamp) + 1));
  assert.equal(calls.length, 2);
  assert.ok(calls.every((item) => item.options.headers.Authorization === undefined));
  assert.ok(calls.some((item) => item.url.startsWith('https://data-api.binance.vision/api/v3/trades?')));
  assert.ok(calls.some((item) => item.url.startsWith('https://data-api.binance.vision/api/v3/klines?')));
});

test('does not query the network for unsupported product/interval', async () => {
  let calls = 0;
  const provider = createBinanceSpotPublicProvider({ fetchImpl: async () => { calls++; return response({}); } });
  await assert.rejects(() => provider.getSnapshot('BTC/USD'), /BINANCE_PUBLIC_SYMBOL_UNSUPPORTED/);
  await assert.rejects(() => provider.getSnapshot('BTC/USDT', '2min'), /BINANCE_PUBLIC_TIMEFRAME_UNSUPPORTED/);
  assert.equal(calls, 0);
});

test('preserves HTTP rate-limit evidence and never fabricates a quote on errors', async () => {
  const provider = createBinanceSpotPublicProvider({
    fetchImpl: async () => response({ code: -1003, msg: 'Too many requests' }, 429, { 'retry-after': '2' })
  });
  await assert.rejects(() => provider.getSnapshot('BTC/USDT'), (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterMs, 2_000);
    assert.equal(error.code, 'BINANCE_PUBLIC_RATE_LIMITED');
    return true;
  });
});

test('rejects malformed kline OHLC and stale trade quotes', async () => {
  const nowMs = Date.now();
  const malformed = fixtures(nowMs);
  malformed.candles[0] = [nowMs, 'bad', '2', '1', '1.5', '1', nowMs + 59_999];
  const badProvider = createBinanceSpotPublicProvider({
    now: () => nowMs,
    fetchImpl: async (url) => response(String(url).includes('/api/v3/trades?') ? malformed.trade : malformed.candles)
  });
  await assert.rejects(() => badProvider.getSnapshot('BTC/USDT'), /PUBLIC_CRYPTO_CANDLE_INVALID/);

  const staleData = fixtures(nowMs, 60_000);
  const stale = createBinanceSpotPublicProvider({
    now: () => nowMs, maxAgeMs: 5_000,
    fetchImpl: async (url) => response(String(url).includes('/api/v3/trades?') ? staleData.trade : staleData.candles)
  });
  const snapshot = await stale.getSnapshot('BTC/USDT');
  assert.equal(snapshot.valid, false);
  assert.equal(snapshot.status, 'STALE');
});
