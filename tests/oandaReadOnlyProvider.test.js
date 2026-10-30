import assert from 'node:assert/strict';
import test from 'node:test';
import { createOandaReadOnlyProvider } from '../data/src/providers/oandaProvider.js';
import { runOandaCommissioning } from '../backend/src/oandaCommissioning.js';

const NOW = Date.parse('2026-09-09T12:00:20.000Z');
const pricing = { prices: [{ instrument: 'EUR_USD', time: '2026-09-09T12:00:10.000Z', closeoutBid: '1.1704', closeoutAsk: '1.1706' }] };
const candle = { time: '2026-09-09T11:59:00.000Z', complete: true, volume: 10, mid: { o: '1.17', h: '1.171', l: '1.169', c: '1.1705' } };
const candles = { instrument: 'EUR_USD', granularity: 'M1', candles: [candle] };
const env = { WILL_OANDA_ENABLED: 'true', OANDA_TOKEN: 'secret-token', OANDA_ACCOUNT_ID: 'secret-account', OANDA_ENVIRONMENT: 'practice' };

function response(body, status = 200, retryAfter = null) {
  return { ok: status >= 200 && status < 300, status, headers: { get: (name) => name === 'retry-after' ? retryAfter : null }, json: async () => body };
}

test('one-shot success performs exactly pricing and M1 midpoint candle GETs', async () => {
  const urls = [];
  const result = await runOandaCommissioning({ env, now: () => NOW, fetchImpl: async (url, options) => {
    urls.push({ url, method: options.method });
    return response(url.includes('/pricing?') ? pricing : candles);
  } });
  assert.equal(result.result, 'LIVE_QUALIFICATION_OBSERVED');
  assert.equal(urls.length, 2);
  assert.ok(urls.some(({ url }) => url.includes('/v3/accounts/secret-account/pricing?instruments=EUR_USD')));
  assert.ok(urls.some(({ url }) => url.includes('/v3/instruments/EUR_USD/candles?price=M&granularity=M1&count=50')));
  assert.ok(urls.every(({ method }) => method === 'GET'));
  assert.equal(result.providerEfficiency.externalRequests, 2);
  assert.equal(result.authoritativeValid, true);
});

test('missing or disabled config fails closed before network access', async () => {
  let calls = 0;
  for (const bad of [{}, { WILL_OANDA_ENABLED: 'true', OANDA_ACCOUNT_ID: 'a' }, { WILL_OANDA_ENABLED: 'true', OANDA_TOKEN: 't' }, { ...env, OANDA_ENVIRONMENT: 'invalid' }]) {
    const result = await runOandaCommissioning({ env: bad, fetchImpl: async () => { calls += 1; } });
    assert.equal(result.result, 'BLOCKED');
    assert.equal(result.reason, 'OANDA_MISCONFIGURED');
  }
  assert.equal(calls, 0);
});

test('401/403 fail MISCONFIGURED without exposing secrets', async () => {
  for (const status of [401, 403]) {
    const result = await runOandaCommissioning({ env, now: () => NOW, fetchImpl: async () => response({}, status) });
    assert.equal(result.result, 'BLOCKED');
    assert.equal(result.readiness.state, 'MISCONFIGURED');
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('secret-token'), false);
    assert.equal(serialized.includes('secret-account'), false);
  }
});

test('429 opens cooldown with no retry storm', async () => {
  let calls = 0;
  const result = await runOandaCommissioning({ env, now: () => NOW, fetchImpl: async () => { calls += 1; return response({}, 429, '12'); } });
  assert.equal(result.result, 'BLOCKED');
  assert.equal(result.readiness.state, 'COOLDOWN');
  assert.equal(result.readiness.cooldownRemainingMs, 12_000);
  assert.equal(calls, 2);
});

test('5xx and network/timeout remain unavailable and bounded', async () => {
  const server = await runOandaCommissioning({ env, now: () => NOW, fetchImpl: async () => response({}, 503) });
  assert.equal(server.result, 'BLOCKED');
  assert.equal(server.readiness.state, 'UNAVAILABLE');
  const network = await runOandaCommissioning({ env, now: () => NOW, fetchImpl: async () => { throw new Error('network'); } });
  assert.equal(network.result, 'BLOCKED');
  assert.equal(network.reason, 'OANDA_NETWORK_ERROR');
  assert.equal(network.readiness.state, 'UNAVAILABLE');
  assert.ok(network.providerEfficiency.externalRequests <= 2);
});

test('stale, incomplete, malformed and mismatched payloads remain blocked', async () => {
  const cases = [
    [{ prices: [{ ...pricing.prices[0], time: '2026-09-09T11:59:40.000Z' }] }, candles],
    [pricing, { ...candles, candles: [{ ...candle, complete: false }] }],
    [pricing, { ...candles, candles: [{ ...candle, mid: { ...candle.mid, h: 'bad' } }] }],
    [pricing, { ...candles, instrument: 'GBP_USD' }],
    [pricing, { ...candles, granularity: 'M5' }]
  ];
  for (const [priceBody, candleBody] of cases) {
    let index = 0;
    const result = await runOandaCommissioning({ env, now: () => NOW, fetchImpl: async () => response(index++ === 0 ? priceBody : candleBody) });
    assert.notEqual(result.result, 'LIVE_QUALIFICATION_OBSERVED');
  }
});

test('providerReceivedAt does not replace quote or latest complete candle timestamps', async () => {
  const result = await runOandaCommissioning({ env, now: () => NOW, fetchImpl: async (url) => response(url.includes('/pricing?') ? pricing : { ...candles, candles: [{ ...candle, time: '2026-09-09T12:00:00.000Z', complete: false }, candle] }) });
  assert.equal(result.quoteTimestamp, pricing.prices[0].time);
  assert.equal(result.latestClosedCandleTimestamp, candle.time);
  assert.notEqual(result.providerReceivedAt, result.quoteTimestamp);
  assert.equal(result.freshnessPolicyVersion, 'rest-quote-freshness-v1');
});

test('provider rejects unqualified symbol/timeframe before request budget', async () => {
  let calls = 0;
  const provider = createOandaReadOnlyProvider({ enabled: true, token: 't', accountId: 'a', fetchImpl: async () => { calls += 1; } });
  await assert.rejects(() => provider.getSnapshot('GBP_USD'), /UNQUALIFIED_MAPPING/);
  await assert.rejects(() => provider.getSnapshot('EUR_USD', '5min'), /UNQUALIFIED_MAPPING/);
  assert.equal(calls, 0);
});
