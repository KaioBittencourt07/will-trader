import assert from 'node:assert/strict';
import test from 'node:test';
import { runHistoricalReplay, splitChronologically, validatePriceObservations } from '../backtest/src/marketValidation.js';

const t0 = '2026-10-01T12:00:00.000Z';
const plus = (ms) => new Date(Date.parse(t0) + ms).toISOString();
const obs = (asset, timestamp, price) => ({ asset, timestamp, price });
const decision = (id, asset, direction, overrides = {}) => ({
  id, asset, direction, timestamp: t0, executable: true, blocked: false, ...overrides
});

test('price observation validation requires explicit timezone, positive price and unique asset-time pairs', () => {
  const report = validatePriceObservations([
    obs('EUR/USD', t0, 1.1),
    obs('EUR/USD', t0, 1.2),
    obs('GBP/USD', '2026-10-01T12:00:00', 1.3),
    obs('XAUUSD', plus(1_000), 0)
  ]);
  assert.equal(report.valid, false);
  assert.equal(report.inputCount, 4);
  assert.equal(report.validCount, 1);
  assert.equal(report.duplicateCount, 1);
  assert.equal(report.invalidRows, 3);
  assert.ok(report.reasonCodes.includes('DUPLICATE_ASSET_TIMESTAMP'));
  assert.ok(report.reasonCodes.includes('INVALID_TIMESTAMP_WITH_TIMEZONE'));
  assert.ok(report.reasonCodes.includes('INVALID_PRICE'));
});

test('price observation validation rejects impossible calendar timestamps', () => {
  const report = validatePriceObservations([
    obs('EUR/USD', '2026-02-31T12:00:00.000Z', 1.1),
    obs('GBP/USD', '2026-10-01T24:00:00.000Z', 1.3),
    obs('USD/JPY', '2024-02-29T12:00:00.000Z', 150)
  ]);
  assert.equal(report.valid, false);
  assert.equal(report.validCount, 1);
  assert.equal(report.invalidRows, 2);
  assert.ok(report.reasonCodes.includes('INVALID_TIMESTAMP_WITH_TIMEZONE'));
});

test('historical replay never fills with the same quote that generated a decision', () => {
  const report = runHistoricalReplay({
    decisions: [decision('buy-1', 'EUR/USD', 'BUY')],
    observations: [
      obs('EUR/USD', t0, 100),
      obs('EUR/USD', plus(1_000), 101),
      obs('EUR/USD', plus(61_000), 102)
    ],
    expirySeconds: 60,
    entryDelayMs: 0
  });
  const [trade] = report.results;
  assert.equal(trade.status, 'SETTLED');
  assert.equal(trade.entryTimestamp, plus(1_000));
  assert.equal(trade.entryPrice, 101);
  assert.equal(trade.targetExpiryTimestamp, plus(61_000));
  assert.equal(trade.settlementTimestamp, plus(61_000));
  assert.equal(trade.settlementPrice, 102);
  assert.equal(trade.outcome, 'WIN');
  assert.equal(trade.pnl, null);
  assert.equal(report.netPnl, null);
  assert.equal(report.edgeProven, false);
  assert.equal(report.status, 'DESCRIPTIVE_ONLY_PAYOUT_REQUIRED');
});

test('BUY, SELL and tie outcomes follow the observed entry-to-expiry direction', () => {
  const report = runHistoricalReplay({
    decisions: [
      decision('buy-win', 'EUR/USD', 'BUY'),
      decision('sell-loss', 'EUR/USD', 'SELL'),
      decision('tie', 'GBP/USD', 'BUY')
    ],
    observations: [
      obs('EUR/USD', t0, 100),
      obs('EUR/USD', plus(1_000), 101),
      obs('EUR/USD', plus(61_000), 102),
      obs('GBP/USD', t0, 200),
      obs('GBP/USD', plus(1_000), 200),
      obs('GBP/USD', plus(61_000), 200)
    ],
    expirySeconds: 60,
    payoutRatio: 0.8,
    stake: 10,
    costPerTrade: 0.5,
    minimumBinaryTrades: 2
  });
  assert.deepEqual(report.results.map((row) => row.outcome), ['WIN', 'LOSS', 'TIE']);
  assert.deepEqual(report.results.map((row) => row.pnl), [7.5, -10.5, -0.5]);
  assert.equal(report.wins, 1);
  assert.equal(report.losses, 1);
  assert.equal(report.ties, 1);
  assert.equal(report.binaryN, 2);
  assert.equal(report.binaryWinRate, 0.5);
  assert.equal(report.settledNetPnl, -3.5);
  assert.equal(report.netPnl, -3.5);
  assert.equal(report.expectancyPerSettledTrade, -3.5 / 3);
  assert.equal(report.breakEvenWinRateWithoutTies, 10.5 / 18);
  assert.equal(report.maxDrawdown, 11);
  assert.equal(report.statisticalReviewReady, true);
  assert.equal(report.edgeProven, false);
  assert.equal(report.status, 'READY_FOR_STATISTICAL_REVIEW_NOT_EDGE_PROOF');
});

test('WAIT and blocked decisions stay in the denominator without becoming trades', () => {
  const report = runHistoricalReplay({
    decisions: [
      decision('wait', 'EUR/USD', 'WAIT', { executable: false }),
      decision('blocked', 'EUR/USD', 'BUY', { blocked: true }),
      decision('not-executable', 'EUR/USD', 'SELL', { executable: false })
    ],
    observations: [obs('EUR/USD', t0, 100)],
    payoutRatio: 0.8
  });
  assert.equal(report.decisionCount, 3);
  assert.equal(report.waitCount, 1);
  assert.equal(report.blockedCount, 2);
  assert.equal(report.actionableSignals, 0);
  assert.equal(report.settledTrades, 0);
  assert.equal(report.noTradeRate, 1);
  assert.equal(report.binaryWinRate, null);
  assert.equal(report.netPnl, 0);
  assert.equal(report.edgeProven, false);
});

test('missing entry/expiry quotes remain unresolved and suppress complete-sample PnL', () => {
  const report = runHistoricalReplay({
    decisions: [decision('no-entry', 'BTC/USD', 'BUY')],
    observations: [obs('BTC/USD', t0, 60_000), obs('BTC/USD', plus(1_000), 60_010)],
    payoutRatio: 0.8
  });
  assert.equal(report.unresolvedTrades, 1);
  assert.equal(report.settledTrades, 0);
  assert.equal(report.netPnl, null);
  assert.equal(report.status, 'INCOMPLETE_UNRESOLVED_TRADES');
  assert.ok(report.reasonCodes.includes('UNRESOLVED_TRADES_PRESENT'));
});

test('invalid market data fails closed rather than silently shrinking the sample', () => {
  assert.throws(() => runHistoricalReplay({
    decisions: [decision('buy', 'EUR/USD', 'BUY')],
    observations: [
      obs('EUR/USD', t0, 1.1),
      obs('EUR/USD', t0, 1.2)
    ],
    payoutRatio: 0.8
  }), /INVALID_MARKET_DATASET:DUPLICATE_ASSET_TIMESTAMP/);
});

test('duplicate decision IDs and malformed decision timestamps are rejected', () => {
  const observations = [obs('EUR/USD', t0, 1.1), obs('EUR/USD', plus(1_000), 1.2)];
  assert.throws(() => runHistoricalReplay({
    decisions: [
      decision('same', 'EUR/USD', 'BUY'),
      decision('same', 'EUR/USD', 'SELL')
    ],
    observations
  }), /DUPLICATE_DECISION_ID/);
  assert.throws(() => runHistoricalReplay({
    decisions: [decision('bad-time', 'EUR/USD', 'BUY', { timestamp: '2026-10-01T12:00:00' })],
    observations
  }), /INVALID_DECISION_TIMESTAMP/);
});

test('chronological split keeps same-time rows together and applies an explicit embargo', () => {
  const rows = [];
  for (let minute = 0; minute < 10; minute++) {
    const timestamp = new Date(Date.parse(t0) + minute * 60_000).toISOString();
    rows.push({ id: `eur-${minute}`, timestamp, asset: 'EUR/USD' });
    rows.push({ id: `gbp-${minute}`, timestamp, asset: 'GBP/USD' });
  }
  const result = splitChronologically(rows, { trainRatio: 0.5, validationRatio: 0.2, embargoMs: 60_000 });
  assert.equal(result.summary.train.uniqueTimestamps, 5);
  assert.equal(result.summary.validation.uniqueTimestamps, 2);
  assert.equal(result.summary.test.uniqueTimestamps, 1);
  assert.equal(result.summary.excludedByEmbargo, 4);
  assert.equal(result.summary.noTimestampGroupSplit, true);
  for (const split of [result.train, result.validation, result.test]) {
    const times = new Set(split.map((row) => row.timestamp));
    assert.equal(split.length, times.size * 2);
  }
  assert.ok(Date.parse(result.summary.train.to) < Date.parse(result.summary.validation.from));
  assert.ok(Date.parse(result.summary.validation.to) < Date.parse(result.summary.test.from));
});

test('chronological split rejects invalid ratios, timestamps and insufficient distinct times', () => {
  assert.throws(() => splitChronologically([], { trainRatio: 0, validationRatio: 0.2 }), /INVALID_SPLIT_RATIOS/);
  assert.throws(() => splitChronologically([{ timestamp: 'bad' }]), /INVALID_SPLIT_TIMESTAMP/);
  assert.throws(() => splitChronologically([
    { timestamp: t0 }, { timestamp: t0 }, { timestamp: t0 }
  ]), /INSUFFICIENT_UNIQUE_TIMESTAMPS/);
});

test('scheduled historical entry respects an explicit future click time', () => {
  const report = runHistoricalReplay({
    decisions: [{
      id: 'scheduled-entry',
      asset: 'EUR/USD',
      direction: 'BUY',
      timestamp: t0,
      plannedEntryTimestamp: plus(60_000),
      executable: true
    }],
    observations: [
      obs('EUR/USD', t0, 100),
      obs('EUR/USD', plus(60_000), 101),
      obs('EUR/USD', plus(120_000), 102)
    ],
    entryDelayMs: 0,
    expirySeconds: 60,
    payoutRatio: 0.8,
    minimumBinaryTrades: 1
  });
  assert.equal(report.results[0].status, 'SETTLED');
  assert.equal(report.results[0].targetEntryTimestamp, plus(60_000));
  assert.equal(report.results[0].entryTimestamp, plus(60_000));
  assert.equal(report.results[0].outcome, 'WIN');
  assert.equal(report.edgeProven, false);
});

test('historical replay refuses a planned click that is not strictly after the signal', () => {
  assert.throws(() => runHistoricalReplay({
    decisions: [{
      id: 'non-future-click',
      asset: 'EUR/USD',
      direction: 'BUY',
      timestamp: t0,
      plannedEntryTimestamp: t0,
      executable: true
    }],
    observations: [obs('EUR/USD', t0, 100), obs('EUR/USD', plus(60_000), 101)]
  }), /PLANNED_ENTRY_MUST_FOLLOW_DECISION/);
});

test('entry and expiry quotes outside configured timing tolerances remain unresolved', () => {
  const lateEntry = runHistoricalReplay({
    decisions: [{
      id: 'late-entry',
      asset: 'EUR/USD',
      direction: 'BUY',
      timestamp: t0,
      plannedEntryTimestamp: plus(60_000),
      executable: true
    }],
    observations: [
      obs('EUR/USD', t0, 100),
      obs('EUR/USD', plus(62_000), 101),
      obs('EUR/USD', plus(122_000), 102)
    ],
    entryDelayMs: 0,
    maxEntryQuoteDelayMs: 1,
    payoutRatio: 0.8
  });
  assert.equal(lateEntry.results[0].status, 'UNRESOLVED');
  assert.equal(lateEntry.results[0].reasonCode, 'ENTRY_QUOTE_TOO_LATE');
  assert.equal(lateEntry.netPnl, null);

  const lateExpiry = runHistoricalReplay({
    decisions: [decision('late-expiry', 'EUR/USD', 'BUY')],
    observations: [
      obs('EUR/USD', t0, 100),
      obs('EUR/USD', plus(1_000), 101),
      obs('EUR/USD', plus(61_001), 102)
    ],
    entryDelayMs: 0,
    expirySeconds: 60,
    maxExpiryQuoteDelayMs: 0,
    payoutRatio: 0.8
  });
  assert.equal(lateExpiry.results[0].status, 'UNRESOLVED');
  assert.equal(lateExpiry.results[0].reasonCode, 'EXPIRY_QUOTE_TOO_LATE');
  assert.equal(lateExpiry.netPnl, null);
});

