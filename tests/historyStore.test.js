import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistoryStore, createHistoryStoreWithPaperAuthority } from '../learning/src/historyStore.js';
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

test('stores a released future manual plan as OPEN and preserves market admission proof', () => {
  const store = createHistoryStore({ id: () => 'released-1' });
  const record = store.recordDecision({
    decision: { direction: 'BUY', releaseEligible: true, executable: false, canClickNow: false, blocked: false, clickTime: '2026-09-14T12:02:00.000Z' },
    data: { asset: 'BTC/USD', timeframe: '1min', price: 77000, valid: true, status: 'OK' },
    context: {
      marketAdmission: { version: 'market-admission-gate-v1', state: 'ADMITTED', stage: 'DATA_ADMITTED', checks: { authorityGate: 'PASS', freshnessGate: 'PASS' } },
      canonicalStudy: { version: 'canonical-market-snapshot-v1', state: 'READY' }
    }
  });
  assert.equal(record.status, 'OPEN');
  assert.equal(record.execution.status, 'PENDING_CONFIRMATION');
  assert.equal(record.metadata.context.marketAdmission.state, 'ADMITTED');
  assert.equal(record.metadata.marketAdmission.state, 'ADMITTED');
  assert.equal(record.metadata.context.canonicalStudy.state, 'READY');
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

test('stores automatic PAPER entry evidence without pretending it was an operator execution', () => {
  const bundle = createHistoryStoreWithPaperAuthority({ now: () => '2026-09-14T12:00:10.000Z', id: () => 'paper-entry-1' });
  const store = bundle.historyStore;
  const record = store.recordDecision({
    decision: { direction: 'BUY', releaseEligible: true, blocked: false, clickTime: '2026-09-14T12:00:00.000Z' },
    data: { asset: 'BTC/USD', timeframe: '1min', price: 100 },
    context: { expirySeconds: 60, monitorCycleId: 'autonomous-paper-monitor-v1:1' }
  });
  const paper = bundle.paperMutationPort.confirmPaperExecution(record.id, {
    referenceTimestamp: '2026-09-14T12:00:03.000Z',
    referencePrice: 101,
    source: 'coinbase-exchange-ticker'
  });
  assert.equal(paper.execution.status, 'PAPER_CONFIRMED');
  assert.equal(paper.execution.actualEntryPrice, 101);
  assert.equal(paper.execution.referenceLagMs, 3_000);
  assert.equal(paper.execution.paperOnly, true);

  const lateBundle = createHistoryStoreWithPaperAuthority({ id: () => 'paper-entry-late' });
  const lateStore = lateBundle.historyStore;
  const late = lateStore.recordDecision({
    decision: { direction: 'BUY', releaseEligible: true, blocked: false, clickTime: '2026-09-14T12:00:00.000Z' },
    data: { asset: 'BTC/USD', timeframe: '1min', price: 100 },
    context: { expirySeconds: 60, monitorCycleId: 'autonomous-paper-monitor-v1:2' }
  });
  assert.throws(() => lateBundle.paperMutationPort.confirmPaperExecution(late.id, {
    referenceTimestamp: '2026-09-14T12:00:31.000Z', referencePrice: 102
  }), /janela congelada/);
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

test('metrics classify automatic live PAPER outcomes separately from operator outcomes', () => {
  const metrics = summarize([
    { direction: 'BUY', asset: 'BTC/USD', status: 'CLOSED', outcome: 'WIN', execution: { status: 'PAPER_CONFIRMED' }, outcomeMetadata: { paperOnly: true, settlementVersion: 'paper-outcome-settlement-v2' } },
    { direction: 'SELL', asset: 'EUR/USD', status: 'CLOSED', outcome: 'LOSS', execution: { status: 'CONFIRMED' }, outcomeMetadata: { recordedBy: 'operator' } }
  ]);
  assert.equal(metrics.provenance.automaticPaperOutcomes, 1);
  assert.equal(metrics.provenance.operatorRecordedOutcomes, 1);
  assert.equal(metrics.provenance.unverifiedOutcomes, 0);
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

test('persists setup explanation and feature version for later segmentation and replay', () => {
  const store = createHistoryStore({ id: () => 'setup-v2-1' });
  const record = store.recordDecision({
    decision: { direction: 'WAIT', blocked: true, setup: 'BREAKOUT', setupType: 'BREAKOUT', setupDirection: 'BUY', setupQuality: 'B', featureVersion: 'candle-price-action-v2', setupEvidence: ['BREAKOUT_CONFIRMED'], setupInvalidation: ['CLOSE_BACK_INSIDE_RANGE'] },
    data: { asset: 'EUR/USD', timeframe: '1min' }
  });
  assert.equal(record.setupQuality, 'B');
  assert.equal(record.featureVersion, 'candle-price-action-v2');
  assert.deepEqual(record.metadata.setup.evidence, ['BREAKOUT_CONFIRMED']);
  const metrics = summarize(store.list());
  assert.equal(metrics.segments.byFeatureVersion[0].key, 'candle-price-action-v2');
  assert.equal(metrics.segments.bySetupQuality[0].key, 'B');
});

test('settling the same recorded outcome is idempotent', () => {
  const store = createHistoryStore({ id: () => 'idempotent-1' });
  store.recordDecision({ decision: { direction: 'BUY', executable: true }, data: { asset: 'EUR/USD', timeframe: '1min', price: 1.17 } });
  store.settle('idempotent-1', 'WIN');
  const repeated = store.settle('idempotent-1', 'WIN');
  assert.equal(repeated.idempotent, true);
  assert.equal(store.list().length, 1);
});
