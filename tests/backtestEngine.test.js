import assert from 'node:assert/strict';
import test from 'node:test';
import { runBacktest } from '../engine/src/backtestEngine.js';

test('backtest produces settled outcomes when signals are executable', () => {
  const candles = Array.from({ length: 4 }, (_, i) => ({
    timestamp: new Date(Date.UTC(2026, 7, 26, 10, i)).toISOString(),
    asset: 'EUR/USD',
    timeframe: '1m',
    price: 1 + i * 0.01
  }));
  const result = runBacktest({ candles });
  assert.equal(result.decisions.length, 4);
  assert.ok(result.performance);
  assert.equal(result.performance.total, result.trades.length);
});

test('backtest does not create an un-settleable trade at the end', () => {
  const candles = [
    { timestamp: '2026-08-26T10:00:00Z', asset: 'EUR/USD', timeframe: '1m', price: 1 },
    { timestamp: '2026-08-26T10:01:00Z', asset: 'EUR/USD', timeframe: '1m', price: 1.01 }
  ];
  const result = runBacktest({ candles, expiryCandles: 1 });
  assert.equal(result.trades.length, 0);
});
