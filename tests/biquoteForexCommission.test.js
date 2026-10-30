import assert from 'node:assert/strict';
import test from 'node:test';
import { assessBiquoteForexCommission } from '../backend/src/commissionBiquoteForexReadOnly.js';

const NOW = Date.parse('2026-09-14T21:40:00.000Z');
const SYMBOLS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'NZDUSD', 'USDCAD', 'GBPJPY'];

function keyedPayload(overrides = {}) {
  return Object.fromEntries(SYMBOLS.map((symbol, index) => [symbol, {
    mid: 1 + index / 100,
    timestamp: '2026-09-14T21:39:55.000Z',
    marketState: 'open',
    stale: false,
    quoteAgeSeconds: 5,
    source: 'MT5',
    ...overrides[symbol]
  }]));
}

test('accepts documented Biquote keyed /api/latest response shape', () => {
  const result = assessBiquoteForexCommission(keyedPayload(), { now: NOW });
  assert.equal(result.version, 'biquote-forex-bounded-commission-v2');
  assert.equal(result.approved, true);
  assert.equal(result.assets.length, 8);
  assert.equal(result.assets.every((asset) => asset.available && asset.approved), true);
  assert.equal(result.ordersExecuted, 0);
});

test('fails closed when one keyed quote is stale or market is not open', () => {
  const payload = keyedPayload({
    GBPUSD: { stale: true, quoteAgeSeconds: 45 },
    USDJPY: { marketState: 'closed' }
  });
  const result = assessBiquoteForexCommission(payload, { now: NOW });
  assert.equal(result.approved, false);
  const gbp = result.assets.find((asset) => asset.symbol === 'GBPUSD');
  const jpy = result.assets.find((asset) => asset.symbol === 'USDJPY');
  assert.ok(gbp.reasons.includes('PROVIDER_STALE_FLAG_NOT_FALSE'));
  assert.ok(gbp.reasons.includes('QUOTE_OLDER_THAN_FROZEN_CONTRACT'));
  assert.ok(jpy.reasons.includes('MARKET_NOT_OPEN'));
});

test('fails closed when a requested symbol is missing from keyed payload', () => {
  const payload = keyedPayload();
  delete payload.USDCAD;
  const result = assessBiquoteForexCommission(payload, { now: NOW });
  assert.equal(result.approved, false);
  const cad = result.assets.find((asset) => asset.symbol === 'USDCAD');
  assert.equal(cad.available, false);
  assert.ok(cad.reasons.includes('SYMBOL_MISSING'));
});
