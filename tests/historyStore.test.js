import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistoryStore } from '../learning/src/historyStore.js';
import { summarize } from '../learning/src/statistics.js';

test('records complete prospective signal context and settles only open trades', () => {
  const store = createHistoryStore({ now: () => '2026-09-01T12:00:00.000Z', id: () => 'signal-1' });
  const record = store.recordDecision({
    decision: { direction: 'BUY', executable: true, score: 81, confidence: 76, regime: 'TREND', setup: 'PULLBACK', clickTime: '12:00:02.000Z' },
    data: { asset: 'EUR/USD', timeframe: '1min', price: 1.17, confirmations: 4, valid: true, status: 'OK', ageMs: 500, source: 'twelvedata' },
    context: { expirySeconds: 60, requiredBars: 50, decisionLatencyMs: 12 }
  });
  assert.equal(record.status, 'OPEN');
  assert.equal(record.metadata.dataQuality.status, 'OK');
  assert.equal(record.metadata.dataQuality.requiredBars, 50);
  assert.equal(record.metadata.context.decisionLatencyMs, 12);
  assert.equal(record.confirmations, 4);
  const settled = store.settle('signal-1', 'WIN', { exitPrice: 1.171 });
  assert.equal(settled.outcome, 'WIN');
  assert.equal(settled.status, 'CLOSED');
});

test('records WAIT without inventing an outcome or click time', () => {
  const store = createHistoryStore({ id: () => 'wait-1' });
  const record = store.recordDecision({ decision: { direction: 'WAIT', blocked: true }, data: { asset: 'EUR/USD', timeframe: '1min' } });
  assert.equal(record.status, 'SKIPPED');
  assert.equal(record.clickTime, null);
  assert.throws(() => store.settle('wait-1', 'WIN'), /Somente sinais abertos/);
});

test('stores the operator actual click and price separately from the planned signal', () => {
  const store = createHistoryStore({ now: () => '2026-09-01T12:02:00.000Z', id: () => 'executed-1' });
  const record = store.recordDecision({ decision: { direction: 'SELL', executable: true, clickTime: '2026-09-01T12:01:00.000Z' }, data: { asset: 'AUD/USD', timeframe: '1min', price: 0.65 } });
  const executed = store.confirmExecution(record.id, { actualClickTime: '2026-09-01T12:01:07.000Z', actualEntryPrice: 0.6498, notes: 'Demo' });
  assert.equal(executed.execution.status, 'CONFIRMED');
  assert.equal(executed.execution.plannedClickTime, '2026-09-01T12:01:00.000Z');
  assert.equal(executed.execution.actualClickTime, '2026-09-01T12:01:07.000Z');
  assert.equal(executed.execution.actualEntryPrice, 0.6498);
});

test('metrics expose WAIT volume separately from completed outcomes', () => {
  const metrics = summarize([
    { direction: 'BUY', asset: 'EUR/USD', outcome: 'WIN' },
    { direction: 'WAIT', asset: 'EUR/USD', outcome: null }
  ]);
  assert.equal(metrics.total, 1);
  assert.equal(metrics.wins, 1);
  assert.equal(metrics.waits, 1);
  assert.equal(metrics.signals, 2);
});

test('metrics keep outcome evidence separated by strategy and model version', () => {
  const metrics = summarize([
    { direction: 'BUY', asset: 'EUR/USD', outcome: 'WIN', strategyVersion: 'will-core-v1', modelVersion: 'deterministic-v1', execution: { status: 'CONFIRMED' } },
    { direction: 'SELL', asset: 'EUR/USD', outcome: 'LOSS', strategyVersion: 'will-core-v1.1', modelVersion: 'deterministic-v1', execution: { status: 'CONFIRMED' } },
    { direction: 'WAIT', asset: 'EUR/USD', strategyVersion: 'will-core-v1.1', modelVersion: 'deterministic-v1' }
  ]);
  assert.deepEqual(metrics.byStrategyVersion, [
    { key: 'will-core-v1', total: 1, wins: 1, winRate: 1 },
    { key: 'will-core-v1.1', total: 1, wins: 0, winRate: 0 }
  ]);
  assert.deepEqual(metrics.byModelVersion, [
    { key: 'deterministic-v1', total: 2, wins: 1, winRate: 0.5 }
  ]);
});

test('stores an immutable, versioned feature snapshot for every decision', () => {
  const store = createHistoryStore({ id: () => 'versioned-1' });
  const data = { asset: 'EUR/USD', timeframe: '1min', price: 1.17, trend: 0.4, momentum: 0.2, structure: 0.5, volatility: 0.3, confirmations: 3, candleCount: 50 };
  const record = store.recordDecision({ decision: { direction: 'WAIT', blocked: true }, data, context: { strategyVersion: 'will-core-v1.1', modelVersion: 'deterministic-v1' } });
  data.trend = -0.9;
  record.metadata.featureSnapshot.structure = -0.9;
  const saved = store.list()[0];
  assert.equal(saved.strategyVersion, 'will-core-v1.1');
  assert.equal(saved.modelVersion, 'deterministic-v1');
  assert.equal(saved.metadata.featureSnapshot.trend, 0.4);
  assert.equal(saved.metadata.featureSnapshot.structure, 0.5);
});

test('settling the same recorded outcome is idempotent', () => {
  const store = createHistoryStore({ id: () => 'idempotent-1' });
  store.recordDecision({ decision: { direction: 'BUY', executable: true }, data: { asset: 'EUR/USD', timeframe: '1min', price: 1.17 } });
  store.settle('idempotent-1', 'WIN');
  const repeated = store.settle('idempotent-1', 'WIN');
  assert.equal(repeated.idempotent, true);
  assert.equal(store.list().length, 1);
});
