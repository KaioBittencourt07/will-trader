import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchTwelveHistoricalDataset,
  TWELVE_HISTORICAL_MAX_POINTS
} from '../data/src/providers/twelveHistoricalDataset.js';

const t0 = Date.parse('2026-10-01T12:00:00.000Z');
const stamp = (ms) => new Date(ms).toISOString();
const key = 'synthetic-test-api-key-123456789';
const row = (openMs, price = 1.1) => ({
  datetime: stamp(openMs).replace(/Z$/, ''),
  open: String(price),
  high: String(price + 0.001),
  low: String(price - 0.001),
  close: String(price + 0.0002)
});
function responseFor(values, { status = 200, headers = {} } = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify({ meta: { symbol: 'EUR/USD', interval: '1min' }, values }));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get(name) { return headers[name.toLowerCase()] ?? null; } },
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); }
  };
}
function args(overrides = {}) {
  return {
    apiKey: key,
    asset: 'eur/usd',
    interval: '1min',
    startDate: stamp(t0),
    endDate: stamp(t0 + 180_000),
    now: () => t0 + 240_000,
    fetchImpl: async () => responseFor([
      row(t0 + 120_000, 1.3),
      row(t0 + 60_000, 1.2),
      row(t0, 1.1)
    ]),
    ...overrides
  };
}

test('historical ingest hashes original response bytes and emits sorted closed-candle close observations', async () => {
  let requestUrl;
  let requestOptions;
  const result = await fetchTwelveHistoricalDataset(args({
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return responseFor([row(t0 + 120_000, 1.3), row(t0, 1.1), row(t0 + 60_000, 1.2)]);
    }
  }));

  assert.equal(result.schemaVersion, 'twelve-historical-dataset-v1');
  assert.equal(result.provider, 'twelvedata');
  assert.equal(result.asset, 'EUR/USD');
  assert.equal(result.interval, '1min');
  assert.equal(result.rawDataset.sha256.length, 64);
  assert.equal(result.rawDataset.bytes.byteLength, result.rawDataset.byteLength);
  assert.equal(result.rowCounts.rawBars, 3);
  assert.equal(result.rowCounts.closedBars, 3);
  assert.deepEqual(result.observations.map((item) => item.timestamp), [
    stamp(t0 + 60_000), stamp(t0 + 120_000), stamp(t0 + 180_000)
  ]);
  assert.deepEqual(result.observations.map((item) => item.price), [1.1002, 1.2002, 1.3002]);
  assert.match(requestUrl, /timezone=UTC/);
  assert.match(requestUrl, /include_ohlc=true/);
  assert.match(requestUrl, /start_date=2026-10-01T12%3A00%3A00/);
  assert.match(requestUrl, /end_date=2026-10-01T12%3A03%3A00/);
  assert.doesNotMatch(requestUrl, /apikey|synthetic-test-api-key/);
  assert.equal(requestOptions.headers.Authorization, `apikey ${key}`);
  assert.equal(result.requestBudget.apiRequests, 1);
});

test('historical ingest excludes a bar whose close was not available at retrieval time', async () => {
  const result = await fetchTwelveHistoricalDataset(args({
    endDate: stamp(t0 + 130_000),
    now: () => t0 + 150_000,
    fetchImpl: async () => responseFor([row(t0 + 120_000, 1.3), row(t0 + 60_000, 1.2), row(t0, 1.1)])
  }));
  assert.equal(result.rowCounts.rawBars, 3);
  assert.equal(result.rowCounts.closedBars, 2);
  assert.equal(result.rowCounts.openOrNotYetClosedBarsExcluded, 1);
  assert.deepEqual(result.observations.map((item) => item.price), [1.1002, 1.2002]);
});

test('historical ingest validates key, bounded range, timeframe and HTTPS allowlist before provider access', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return responseFor([row(t0)]); };
  await assert.rejects(() => fetchTwelveHistoricalDataset(args({ apiKey: 'configure_um_token_secreto_longo', fetchImpl })), /TWELVEDATA_REAL_API_KEY_REQUIRED/);
  await assert.rejects(() => fetchTwelveHistoricalDataset(args({ interval: '1day', fetchImpl })), /HISTORICAL_INTRADAY_INTERVAL_REQUIRED/);
  await assert.rejects(() => fetchTwelveHistoricalDataset(args({
    endDate: stamp(t0 + 600_000), interval: '1min', maxPoints: 5, fetchImpl
  })), /HISTORICAL_WINDOW_EXCEEDS_POINT_BUDGET/);
  await assert.rejects(() => fetchTwelveHistoricalDataset(args({
    baseUrl: 'http://api.twelvedata.com', fetchImpl
  })), /HISTORICAL_BASE_URL_NOT_ALLOWED/);
  await assert.rejects(() => fetchTwelveHistoricalDataset(args({
    endDate: stamp(t0 + 600_000), now: () => t0, fetchImpl
  })), /HISTORICAL_END_MUST_NOT_BE_IN_FUTURE/);
  await assert.rejects(() => fetchTwelveHistoricalDataset(args({
    startDate: stamp(t0 + 500), fetchImpl
  })), /HISTORICAL_WINDOW_MUST_ALIGN_TO_SECONDS/);
  assert.equal(calls, 0);
  assert.equal(TWELVE_HISTORICAL_MAX_POINTS, 5000);
});

test('historical ingest rejects API errors without exposing provider body or credentials', async () => {
  await assert.rejects(
    () => fetchTwelveHistoricalDataset(args({
      fetchImpl: async () => responseFor([], { status: 429, headers: { 'retry-after': '60' } })
    })),
    (error) => {
      assert.equal(error.message, 'TWELVEDATA_HISTORICAL_HTTP_429');
      assert.equal(error.status, 429);
      assert.equal(error.retryAfterMs, 60_000);
      assert.equal(error.message.includes(key), false);
      return true;
    }
  );
});

test('historical ingest fails closed for invalid OHLC, out-of-window and duplicate bars', async (t) => {
  await t.test('invalid OHLC', async () => {
    await assert.rejects(() => fetchTwelveHistoricalDataset(args({
      fetchImpl: async () => responseFor([{ ...row(t0), high: '1.0', low: '1.2' }])
    })), /HISTORICAL_OHLC_INCONSISTENT/);
  });
  await t.test('out of window', async () => {
    await assert.rejects(() => fetchTwelveHistoricalDataset(args({
      fetchImpl: async () => responseFor([row(t0 - 60_000)])
    })), /HISTORICAL_BAR_OUTSIDE_REQUESTED_WINDOW/);
  });
  await t.test('duplicate bars', async () => {
    await assert.rejects(() => fetchTwelveHistoricalDataset(args({
      fetchImpl: async () => responseFor([row(t0), row(t0)])
    })), /HISTORICAL_BAR_TIMESTAMP_DUPLICATE/);
  });
});

test('historical ingest excludes closed candles whose close falls after the requested end boundary', async () => {
  const result = await fetchTwelveHistoricalDataset(args({
    endDate: stamp(t0 + 130_000),
    now: () => t0 + 240_000,
    fetchImpl: async () => responseFor([row(t0 + 120_000, 1.3), row(t0 + 60_000, 1.2), row(t0, 1.1)])
  }));
  assert.equal(result.rowCounts.rawBars, 3);
  assert.equal(result.rowCounts.closedBars, 2);
  assert.equal(result.rowCounts.openOrNotYetClosedBarsExcluded, 0);
  assert.equal(result.rowCounts.closedBarsOutsideRequestedWindowExcluded, 1);
  assert.deepEqual(result.observations.map((item) => item.timestamp), [
    stamp(t0 + 60_000), stamp(t0 + 120_000)
  ]);
});

