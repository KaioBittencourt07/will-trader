import assert from 'node:assert/strict';
import test from 'node:test';
import { createTradeRecord, settleTrade, calculatePerformance } from '../engine/src/tradeMemory.js';

test('settles BUY as WIN when price rises', () => {
  const trade = createTradeRecord({ asset: 'EUR/USD', direction: 'BUY', entryPrice: 1.1, entryTime: new Date().toISOString() });
  const result = settleTrade(trade, 1.2);
  assert.equal(result.result, 'WIN');
  assert.ok(result.pnl > 0);
});

test('calculates win rate from settled trades', () => {
  const base = { asset: 'EUR/USD', entryTime: new Date().toISOString() };
  const trades = [
    settleTrade(createTradeRecord({ ...base, direction: 'BUY', entryPrice: 1 }), 1.1),
    settleTrade(createTradeRecord({ ...base, direction: 'BUY', entryPrice: 1 }), 0.9),
  ];
  const metrics = calculatePerformance(trades);
  assert.equal(metrics.total, 2);
  assert.equal(metrics.wins, 1);
  assert.equal(metrics.losses, 1);
  assert.equal(metrics.winRate, 50);
});
