import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchFrankfurterDailyReference } from './fxReferenceRate.js';

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('returns an explicitly daily, non-trading-eligible FX reference rate', async () => {
  const nowMs = Date.parse('2026-10-22T12:00:00Z');
  let requestedUrl;
  const result = await fetchFrankfurterDailyReference({
    base: 'usd',
    quote: 'brl',
    now: () => nowMs,
    fetchImpl: async (url, options) => {
      requestedUrl = String(url);
      assert.equal(options.headers.Authorization, undefined);
      return response([{ date: '2026-10-21', base: 'USD', quote: 'BRL', rate: 5.4 }]);
    }
  });
  assert.match(requestedUrl, /^https:\/\/api\.frankfurter\.dev\/v2\/rates\?/);
  assert.equal(result.pair, 'USD/BRL');
  assert.equal(result.rate, 5.4);
  assert.equal(result.referenceDate, '2026-10-21');
  assert.equal(result.ageDays, 1);
  assert.equal(result.status, 'REFERENCE_OK');
  assert.equal(result.tradingEligible, false);
  assert.equal(result.signalEligible, false);
});

test('flags old daily FX reference data as stale instead of pretending it is live', async () => {
  const result = await fetchFrankfurterDailyReference({
    base: 'EUR',
    quote: 'USD',
    now: () => Date.parse('2026-10-22T12:00:00Z'),
    fetchImpl: async () => response([{ date: '2026-10-01', base: 'EUR', quote: 'USD', rate: 1.1 }])
  });
  assert.equal(result.status, 'REFERENCE_STALE');
  assert.equal(result.tradingEligible, false);
});

test('validates currency codes before network access', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return response([]); };
  await assert.rejects(() => fetchFrankfurterDailyReference({ base: 'USDD', quote: 'BRL', fetchImpl }), /FX_REFERENCE_CURRENCY_INVALID/);
  await assert.rejects(() => fetchFrankfurterDailyReference({ base: 'USD', quote: 'USD', fetchImpl }), /FX_REFERENCE_CURRENCY_INVALID/);
  assert.equal(calls, 0);
});

test('rejects malformed, missing and future-dated reference observations', async () => {
  await assert.rejects(() => fetchFrankfurterDailyReference({
    base: 'USD', quote: 'BRL', now: () => Date.parse('2026-10-22T00:00:00Z'),
    fetchImpl: async () => response([{ date: '2026-10-22', base: 'EUR', quote: 'USD', rate: 1.1 }])
  }), /FX_REFERENCE_RATE_MISSING_OR_INVALID/);
  await assert.rejects(() => fetchFrankfurterDailyReference({
    base: 'USD', quote: 'BRL', now: () => Date.parse('2026-10-22T00:00:00Z'),
    fetchImpl: async () => response([{ date: '2026-10-23', base: 'USD', quote: 'BRL', rate: 5.4 }])
  }), /FX_REFERENCE_DATE_IN_FUTURE/);
  await assert.rejects(() => fetchFrankfurterDailyReference({
    base: 'USD', quote: 'BRL', fetchImpl: async () => response({ error: 'invalid shape' })
  }), /FX_REFERENCE_RESPONSE_INVALID/);
});

test('does not retry or conceal provider HTTP failures', async () => {
  await assert.rejects(() => fetchFrankfurterDailyReference({
    base: 'USD', quote: 'BRL', fetchImpl: async () => response({}, 503)
  }), (error) => error.status === 503 && /HTTP_503/.test(error.message));
});
