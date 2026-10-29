import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import test from 'node:test';
import marketRouter from './market.js';

function response(body, status = 200, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: (name) => headers[name.toLowerCase()] ?? null }, json: async () => body };
}

function seriesBody(nowMs = Date.now()) {
  const latestOpen = Math.floor(nowMs / 60_000) * 60_000 - 60_000;
  return { values: Array.from({ length: 30 }, (_, i) => {
    const openMs = latestOpen - i * 60_000;
    const close = 1.17 - i * 0.0002;
    return { datetime: new Date(openMs).toISOString(), open: String(close - 0.0001), high: String(close + 0.0002), low: String(close - 0.0002), close: String(close) };
  }) };
}
function httpGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try { body = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
  });
}

test('market source routing prefers exact public crypto mappings, identifies sources and falls back transparently', async (t) => {
  const previousKey = process.env.TWELVEDATA_API_KEY;
  const previousFetch = globalThis.fetch;
  delete process.env.TWELVEDATA_API_KEY;
  let failCoinbaseForEth = false;
  const providerCalls = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    providerCalls.push({ host: url.host, path: url.pathname, query: url.search, authorized: Boolean(options.headers?.Authorization) });
    const nowMs = Date.now();

    if (url.host === 'api.exchange.coinbase.com') {
      if (failCoinbaseForEth && url.pathname.endsWith('/ETH-USD/ticker')) return response({ message: 'test unavailable' }, 503);
      if (url.pathname.endsWith('/ticker')) return response({ price: '101.45', time: new Date(nowMs - 500).toISOString() });
      if (url.pathname.endsWith('/candles')) {
        const latestOpen = Math.floor(nowMs / 60_000) * 60_000 - 60_000;
        return response(Array.from({ length: 30 }, (_, index) => {
          const openMs = latestOpen - index * 60_000;
          const close = 100 + (29 - index) * 0.05;
          return [Math.floor(openMs / 1000), close - 0.02, close + 0.04, close - 0.01, close, 12.5];
        }));
      }
    }

    if (url.host === 'api.frankfurter.dev' && url.pathname === '/v2/rates') {
      const yesterday = new Date(nowMs - 86_400_000).toISOString().slice(0, 10);
      return response([{ date: yesterday, base: 'USD', quote: 'BRL', rate: 5.42 }]);
    }

    if (url.host === 'data-api.binance.vision') {
      if (url.pathname.endsWith('/trades')) return response([{ id: 1, price: '60348.2', qty: '0.01', time: nowMs - 500, isBuyerMaker: false, isBestMatch: true }]);
      if (url.pathname.endsWith('/klines')) {
        const latestOpen = Math.floor(nowMs / 60_000) * 60_000 - 60_000;
        return response(Array.from({ length: 30 }, (_, index) => {
          const openMs = latestOpen - index * 60_000;
          const close = 60300 + (29 - index) * 12;
          return [openMs, close - 4, close + 10, close - 1, close, 1.25, openMs + 59_999, '75000', 200, '0.75', '45000', '0'];
        }));
      }
    }

    if (url.host === 'api.twelvedata.com') {
      if (url.pathname === '/quote') return response({ close: '1.1700', timestamp: Math.floor(nowMs / 1000), is_market_open: true });
      if (url.pathname === '/time_series') return response(seriesBody(nowMs));
    }
    throw new Error('UNEXPECTED_TEST_PROVIDER_URL');
  };

  const app = express();
  app.use('/api', marketRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.TWELVEDATA_API_KEY;
    else process.env.TWELVEDATA_API_KEY = previousKey;
  });

  const coinbase = await httpGet(server.address().port, '/api/market?asset=BTC%2FUSD&timeframe=1min&outputsize=20');
  assert.equal(coinbase.status, 200);
  assert.equal(coinbase.body.snapshot.source, 'coinbase-exchange-rest');
  assert.equal(coinbase.body.snapshot.marketVenue, 'COINBASE_EXCHANGE');
  assert.equal(coinbase.body.snapshot.quoteCurrency, 'USD');
  assert.equal(coinbase.body.snapshot.providerSelection.fallback, false);
  assert.equal(coinbase.body.snapshot.authoritativeFreshness.authorityGate, 'PASS');

  const binance = await httpGet(server.address().port, '/api/market?asset=BTC%2FUSDT&timeframe=1min&outputsize=20');
  assert.equal(binance.status, 200);
  assert.equal(binance.body.snapshot.source, 'binance-spot-rest');
  assert.equal(binance.body.snapshot.marketVenue, 'BINANCE_SPOT');
  assert.equal(binance.body.snapshot.quoteCurrency, 'USDT');
  assert.equal(binance.body.snapshot.timestampOrigins.quoteTimestampField, 'trades[0].time');
  assert.equal(binance.body.snapshot.providerSelection.fallback, false);

  const reference = await httpGet(server.address().port, '/api/market/reference/fx?base=USD&quote=BRL');
  assert.equal(reference.status, 200);
  assert.equal(reference.body.reference.pair, 'USD/BRL');
  assert.equal(reference.body.reference.status, 'REFERENCE_OK');
  assert.equal(reference.body.reference.tradingEligible, false);
  assert.equal(reference.body.reference.signalEligible, false);

  const status = await httpGet(server.address().port, '/api/market/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.ok, true);
  assert.equal(status.body.direct.state, 'UNCONFIGURED');
  assert.equal(status.body.marketSources.sources.find((source) => source.id === 'coinbase-exchange-rest').status, 'RESPONSE_OBSERVED');
  assert.ok(status.body.marketSources.sources.find((source) => source.id === 'coinbase-exchange-rest').runtimeObservation.successfulSnapshots > 0);
  assert.equal(status.body.marketSources.sources.find((source) => source.id === 'binance-spot-rest').status, 'RESPONSE_OBSERVED');
  assert.ok(status.body.marketSources.sources.find((source) => source.id === 'binance-spot-rest').runtimeObservation.successfulSnapshots > 0);
  assert.equal(status.body.marketSources.sources.find((source) => source.id === 'avalon-traderoom').status, 'NOT_CONNECTED');

  const catalog = await httpGet(server.address().port, '/api/market/sources');
  assert.equal(catalog.status, 200);
  assert.equal(catalog.body.connectionChecksPerformed, false);
  assert.equal(catalog.body.sources.find((source) => source.id === 'avalon-traderoom').status, 'NOT_CONNECTED');

  failCoinbaseForEth = true;
  process.env.TWELVEDATA_API_KEY = 'synthetic-will-test-key-not-secret-0001';
  const fallback = await httpGet(server.address().port, '/api/market?asset=ETH%2FUSD&timeframe=1min&outputsize=20');
  assert.equal(fallback.status, 200);
  assert.equal(fallback.body.snapshot.source, 'twelvedata');
  assert.equal(fallback.body.snapshot.providerSelection.fallback, true);
  assert.equal(fallback.body.snapshot.providerSelection.requestedProvider, 'coinbase-exchange-rest');
  assert.equal(fallback.body.snapshot.providerSelection.priorFailure, 'SOURCE_UNAVAILABLE');

  assert.ok(providerCalls.some((call) => call.host === 'api.exchange.coinbase.com'));
  assert.ok(providerCalls.some((call) => call.host === 'data-api.binance.vision'));
  assert.ok(providerCalls.some((call) => call.host === 'api.twelvedata.com'));
  assert.ok(providerCalls.every((call) => !call.query.toLowerCase().includes('apikey=')));
  assert.ok(providerCalls.every((call) => call.authorized === false || call.host === 'api.twelvedata.com'));
});
