import test from 'node:test';
import assert from 'node:assert/strict';
import { assessBiquoteForexCommission } from './commissionBiquoteForexReadOnly.js';

const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'NZDUSD', 'USDCAD', 'GBPJPY'];

test('approves all eight fresh open forex ticks', () => {
  const now = Date.parse('2026-09-14T20:00:00.000Z');
  const payload = symbols.map((symbol, index) => ({
    symbol,
    mid: 1 + index / 100,
    timestamp: '2026-09-14T19:59:55.000Z',
    source: 'MetaTrader 5 (Broker 1)',
    marketState: 'open',
    stale: false,
    quoteAgeSeconds: 5
  }));
  const result = assessBiquoteForexCommission(payload, { now });
  assert.equal(result.approved, true);
  assert.equal(result.assets.length, 8);
  assert.equal(result.ordersExecuted, 0);
});

test('fails closed when any forex tick is stale', () => {
  const now = Date.parse('2026-09-14T20:00:00.000Z');
  const payload = symbols.map((symbol, index) => ({
    symbol,
    mid: 1 + index / 100,
    timestamp: index === 0 ? '2026-09-14T19:58:00.000Z' : '2026-09-14T19:59:55.000Z',
    source: 'MetaTrader 5 (Broker 1)',
    marketState: 'open',
    stale: index === 0,
    quoteAgeSeconds: index === 0 ? 120 : 5
  }));
  const result = assessBiquoteForexCommission(payload, { now });
  assert.equal(result.approved, false);
  assert.equal(result.qualification, 'BLOCKED');
});
