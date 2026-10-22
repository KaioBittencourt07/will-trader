import assert from 'node:assert/strict';
import test from 'node:test';
import { runWillStrategyReplay } from '../backtest/src/willStrategyReplay.js';

const startMs = Date.parse('2026-10-01T12:00:00.000Z');
const toIso = (value) => new Date(value).toISOString();

function makeBars(count = 80, { shiftFrom = Infinity, shift = 0 } = {}) {
  const bars = [];
  let previousClose = 100;
  for (let i = 0; i < count; i++) {
    const openMs = startMs + i * 60_000;
    const open = previousClose;
    const baseClose = 100 + (i * 0.08) + (Math.sin(i / 3) * 0.025);
    const close = baseClose + (i >= shiftFrom ? shift : 0);
    const high = Math.max(open, close) + 0.04;
    const low = Math.min(open, close) - 0.04;
    bars.push({
      barOpenTimestamp: toIso(openMs),
      barCloseTimestamp: toIso(openMs + 60_000),
      open, high, low, close
    });
    previousClose = close;
  }
  return bars;
}

function run(bars, overrides = {}) {
  return runWillStrategyReplay({
    bars,
    asset: 'EUR/USD',
    interval: '1min',
    asOfTimestamp: bars.at(-1).barCloseTimestamp,
    strategyOptions: {
      minimumConfidence: 1,
      technicalOnlyDiagnostic: true,
      entryWindowStartSeconds: 60,
      entryWindowEndSeconds: 300,
      entryDelaySeconds: 120,
      expirySeconds: 60
    },
    replayOptions: {
      minimumBinaryTrades: 1,
      maxEntryQuoteDelayMs: 5_000,
      maxExpiryQuoteDelayMs: 5_000,
      ...overrides
    }
  });
}

test('runs the actual WILL feature and decision pipeline over completed OHLC prefixes', () => {
  const bars = makeBars();
  const report = run(bars);

  assert.equal(report.mode, 'WILL_STRATEGY_HISTORICAL_OHLC_REPLAY');
  assert.equal(report.strategy.source, 'ACTUAL_WILL_PIPELINE');
  assert.equal(report.barsAvailable, 80);
  assert.equal(report.decisionBars, 69);
  assert.equal(report.decisions.length, 69);
  assert.equal(report.results.length, 69);
  assert.equal(report.edgeProven, false);
  assert.equal(report.decisions[0].candlesUsed, 12);
  assert.equal(report.decisions.at(-1).candlesUsed, 80);
  assert.ok(report.decisions.every((decision) => decision.decisionCandleCloseTimestamp <= report.asOfTimestamp));
  assert.ok(report.decisions.every((decision) => decision.direction === 'BUY' || decision.direction === 'SELL' || decision.direction === 'WAIT'));
  assert.ok(report.decisions.every((decision) => typeof decision.confidence === 'number'));
  assert.equal(Object.hasOwn(report.decisions[0], 'probability'), false);
});

test('scheduled entries are explicitly future-dated and are not represented as executable at decision time', () => {
  const report = run(makeBars());
  const scheduled = report.decisions.filter((decision) => decision.executable);

  assert.ok(scheduled.length > 0, 'fixture should produce at least one scheduled signal');
  for (const decision of scheduled) {
    assert.ok(Date.parse(decision.clickTime) > Date.parse(decision.decisionTimestamp));
    assert.equal(decision.executableAtDecisionTime, false);
    assert.equal(decision.releaseEligible, true);
  }
  assert.equal(report.edgeProven, false);
});

test('decision trace is invariant to later bars not present in the decision prefix', () => {
  const original = makeBars(80);
  const changedFuture = makeBars(80, { shiftFrom: 50, shift: 15 });
  const a = run(original);
  const b = run(changedFuture);

  const decisionCountBeforeChange = 50 - 11;
  assert.deepEqual(
    a.decisions.slice(0, decisionCountBeforeChange),
    b.decisions.slice(0, decisionCountBeforeChange)
  );
  assert.equal(a.edgeProven, false);
  assert.equal(b.edgeProven, false);
});

test('refuses incomplete/future candles, duplicate times, bad OHLC, or insufficient bars', () => {
  const bars = makeBars();
  assert.throws(() => runWillStrategyReplay({
    bars: bars.slice(0, 11),
    asset: 'EUR/USD',
    interval: '1min',
    asOfTimestamp: bars[10].barCloseTimestamp
  }), /AT_LEAST_12_COMPLETED_BARS/);

  const duplicated = makeBars();
  duplicated[12].barOpenTimestamp = duplicated[11].barOpenTimestamp;
  assert.throws(() => run(duplicated), /NOT_STRICTLY_CHRONOLOGICAL/);

  const invalidOhlc = makeBars();
  invalidOhlc[15].high = invalidOhlc[15].low - 1;
  assert.throws(() => run(invalidOhlc), /OHLC_INVALID/);

  const futureAsOf = makeBars();
  assert.throws(() => runWillStrategyReplay({
    bars: futureAsOf,
    asset: 'EUR/USD',
    interval: '1min',
    asOfTimestamp: toIso(startMs + 20_000)
  }), /OPEN_OR_FUTURE_BAR_REJECTED/);

  assert.throws(() => runWillStrategyReplay({
    bars,
    asset: 'EUR/USD',
    interval: '1min',
    asOfTimestamp: '2026-10-01T12:00:00'
  }), /AS_OF_TIMESTAMP_REQUIRED_WITH_TIMEZONE/);
});

test('unknown payout keeps financial PnL unavailable; unresolved future entry/expiry is never guessed', () => {
  const shortBars = makeBars(18);
  const report = run(shortBars);

  assert.equal(report.edgeProven, false);
  assert.equal(report.netPnl, null);
  assert.equal(report.status, 'INCOMPLETE_UNRESOLVED_TRADES');
  assert.ok(report.unresolvedTrades > 0);
  assert.equal(report.reasonCodes.includes('UNRESOLVED_TRADES_PRESENT'), true);
});

test('missing historical macro/news context blocks directional decisions by default', () => {
  const bars = makeBars();
  const report = runWillStrategyReplay({
    bars,
    asset: 'EUR/USD',
    interval: '1min',
    asOfTimestamp: bars.at(-1).barCloseTimestamp,
    strategyOptions: { minimumConfidence: 1 }
  });

  assert.equal(report.strategy.contextMode, 'MISSING_MACRO_NEWS_FAIL_CLOSED');
  assert.equal(report.strategy.macroBlocked, true);
  assert.equal(report.strategy.newsBlocked, true);
  assert.equal(report.decisions.some((decision) => decision.executable), false);
  assert.ok(report.blockedCount > 0);
  assert.equal(report.edgeProven, false);
});

