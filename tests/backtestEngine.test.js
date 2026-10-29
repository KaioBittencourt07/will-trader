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

test('legacy candle backtest labels price-delta PnL as a proxy, never as edge proof', () => {
  const candles = Array.from({ length: 6 }, (_, i) => ({
    timestamp: new Date(Date.UTC(2026, 7, 26, 10, i)).toISOString(),
    asset: 'EUR/USD',
    timeframe: '1m',
    price: 1 + i * 0.01,
    trend: 0.9,
    momentum: 0.8,
    structure: 0.9,
    volatility: 0.2,
    confirmations: 6,
    candleCount: 100
  }));
  const result = runBacktest({ candles, context: {
    nowMs: Date.parse(candles[0].timestamp),
    minimumConfidence: 1,
    entryWindowStartSeconds: 60,
    entryWindowEndSeconds: 300,
    entryDelaySeconds: 120,
    expirySeconds: 60
  }});

  assert.equal(result.schemaVersion, 'will-legacy-backtest-v1');
  assert.equal(result.mode, 'LEGACY_CANDLE_PRICE_PROXY_NOT_EXECUTION_ACCURATE');
  assert.equal(result.edgeProven, false);
  assert.equal(result.performance.pnlSemantics, 'RAW_PRICE_DELTA_NOT_CASH_PNL');
  assert.equal(result.performance.winRateSemantics, 'OUTCOME_FREQUENCY_WITHOUT_PAYOUT_OR_COST_MODEL');
  assert.ok(result.warnings.some((warning) => warning.includes('not an execution-accurate')));
});

