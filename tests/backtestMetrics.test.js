import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateMetrics } from '../backtest/src/metrics.js';
import { timeSplit } from '../backtest/src/split.js';

test('legacy metrics do not label unit outcome scores as financial PnL without payout', () => {
  const report = calculateMetrics([
    { outcome: 'WIN' },
    { outcome: 'LOSS' },
    { outcome: 'TIE' },
    { outcome: 'WAIT' }
  ]);
  assert.equal(report.sampleSize, 2);
  assert.equal(report.settledSampleSize, 3);
  assert.equal(report.wins, 1);
  assert.equal(report.losses, 1);
  assert.equal(report.ties, 1);
  assert.equal(report.netUnits, 0);
  assert.equal(report.netPnl, null);
  assert.equal(report.financialExpectancyPerSettledTrade, null);
  assert.equal(report.financialMetricsStatus, 'PAYOUT_RATIO_REQUIRED');
  assert.equal(report.edgeProven, false);
});

test('legacy metrics calculate payout-aware PnL only when payout and costs are explicit', () => {
  const report = calculateMetrics([
    { outcome: 'WIN' },
    { outcome: 'LOSS' },
    { outcome: 'TIE' }
  ], { payoutRatio: 0.8, stake: 10, costPerTrade: 0.5 });
  assert.equal(report.netPnl, -3.5);
  assert.equal(report.financialExpectancyPerSettledTrade, -3.5 / 3);
  assert.equal(report.breakEvenWinRateWithoutTies, 10.5 / 18);
  assert.equal(report.metricSemantics, 'LEGACY_PLUS_ONE_MINUS_ONE_OUTCOME_SCORE_NOT_CASH_PNL');
  assert.equal(report.edgeProven, false);
});

test('metrics reject invalid payout, stake and trade cost assumptions', () => {
  assert.throws(() => calculateMetrics([], { payoutRatio: 0 }), /INVALID_PAYOUT_RATIO/);
  assert.throws(() => calculateMetrics([], { stake: 0 }), /INVALID_STAKE/);
  assert.throws(() => calculateMetrics([], { costPerTrade: -1 }), /INVALID_COST_PER_TRADE/);
});

test('legacy timeSplit keeps duplicate timestamps together and accepts a label-horizon embargo', () => {
  const records = [];
  for (let i = 0; i < 10; i++) {
    const timestamp = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
    records.push({ id: `a-${i}`, asset: 'EUR/USD', timestamp });
    records.push({ id: `b-${i}`, asset: 'GBP/USD', timestamp });
  }
  const split = timeSplit(records, { train: 0.5, validation: 0.2, embargoMs: 60_000 });
  for (const rows of [split.train, split.validation, split.test]) {
    const timestamps = new Set(rows.map((row) => row.timestamp));
    assert.equal(rows.length, timestamps.size * 2);
  }
  assert.ok(Date.parse(split.train.at(-1).timestamp) < Date.parse(split.validation[0].timestamp));
  assert.ok(Date.parse(split.validation.at(-1).timestamp) < Date.parse(split.test[0].timestamp));
});

test('timeSplit fails closed on timezone-ambiguous or insufficient historical samples', () => {
  assert.throws(() => timeSplit([{ timestamp: '2026-01-01T00:00:00' }]), /INVALID_SPLIT_TIMESTAMP/);
  assert.throws(() => timeSplit([{ timestamp: '2026-01-01T00:00:00Z' }]), /INSUFFICIENT_UNIQUE_TIMESTAMPS/);
});
