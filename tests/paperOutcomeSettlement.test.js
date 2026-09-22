import assert from 'node:assert/strict';
import test from 'node:test';
import { settleDuePaperCampaignOutcomes } from '../backend/src/paperOutcomeSettlement.js';

function campaignRecord({ id, asset, direction, entryPrice, clickTime, execution = null }) {
  return {
    id,
    asset,
    direction,
    entryPrice,
    clickTime,
    status: 'OPEN',
    outcome: null,
    execution: execution ?? { status: 'PENDING_CONFIRMATION', plannedClickTime: clickTime, actualClickTime: null, actualEntryPrice: null },
    metadata: { context: { expirySeconds: 60, monitorCycleId: 'autonomous-paper-monitor-v1:123' } }
  };
}

function store(initial) {
  let records = structuredClone(initial);
  return {
    list: () => structuredClone(records),
    confirmPaperExecution(id, { referenceTimestamp, referencePrice, source }) {
      const index = records.findIndex((record) => record.id === id);
      if (index < 0) throw new Error('missing');
      records[index] = {
        ...records[index],
        execution: {
          ...records[index].execution,
          status: 'PAPER_CONFIRMED',
          actualClickTime: referenceTimestamp,
          actualEntryPrice: referencePrice,
          paperOnly: true,
          source
        }
      };
      return structuredClone(records[index]);
    },
    settlePaperOutcome(id, outcome, metadata = {}) {
      const index = records.findIndex((record) => record.id === id);
      if (index < 0) throw new Error('missing');
      records[index] = { ...records[index], status: 'CLOSED', outcome, outcomeMetadata: metadata };
      return structuredClone(records[index]);
    }
  };
}

test('captures prospective PAPER entries first, then settles BUY and SELL from post-expiry references', () => {
  const records = [
    campaignRecord({ id: 'buy', asset: 'BTC/USD', direction: 'BUY', entryPrice: 99, clickTime: '2026-09-14T12:00:00.000Z' }),
    campaignRecord({ id: 'sell', asset: 'EUR/USD', direction: 'SELL', entryPrice: 1.21, clickTime: '2026-09-14T12:00:00.000Z' })
  ];
  const historyStore = store(records);
  const coinbaseTemporalFeeds = new Map([['BTC/USD', {
    referenceAtOrAfter: (target) => {
      const ms = Number(target);
      if (ms === Date.parse('2026-09-14T12:00:00.000Z')) return { provider: 'coinbase-exchange-ticker', price: 100, timestamp: '2026-09-14T12:00:02.000Z', lagMs: 2_000, valid: true, status: 'OK' };
      if (ms === Date.parse('2026-09-14T12:01:02.000Z')) return { provider: 'coinbase-exchange-ticker', price: 101, timestamp: '2026-09-14T12:01:04.000Z', lagMs: 2_000, valid: true, status: 'OK' };
      return null;
    }
  }]]);
  const biquoteForexFeed = {
    referenceAtOrAfter: (_asset, target) => {
      const ms = Number(target);
      if (ms === Date.parse('2026-09-14T12:00:00.000Z')) return { provider: 'biquote-forex', price: 1.2, timestamp: '2026-09-14T12:00:03.000Z', lagMs: 3_000, valid: true, status: 'OK' };
      if (ms === Date.parse('2026-09-14T12:01:03.000Z')) return { provider: 'biquote-forex', price: 1.19, timestamp: '2026-09-14T12:01:05.000Z', lagMs: 2_000, valid: true, status: 'OK' };
      return null;
    }
  };

  const result = settleDuePaperCampaignOutcomes({
    historyStore,
    coinbaseTemporalFeeds,
    biquoteForexFeed,
    now: Date.parse('2026-09-14T12:01:10.000Z')
  });

  assert.equal(result.entriesCaptured, 2);
  assert.equal(result.settled, 2);
  assert.equal(result.wins, 2);
  assert.equal(result.losses, 0);
  assert.deepEqual(historyStore.list().map((record) => record.outcome), ['WIN', 'WIN']);
  assert.deepEqual(historyStore.list().map((record) => record.execution.actualEntryPrice), [100, 1.2]);
});

test('keeps a campaign signal pending before its planned PAPER entry time', () => {
  const historyStore = store([
    campaignRecord({ id: 'early', asset: 'BTC/USD', direction: 'BUY', entryPrice: 100, clickTime: '2026-09-14T12:01:00.000Z' })
  ]);
  const result = settleDuePaperCampaignOutcomes({
    historyStore,
    coinbaseTemporalFeeds: new Map(),
    biquoteForexFeed: null,
    now: Date.parse('2026-09-14T12:00:30.000Z')
  });
  assert.equal(result.settled, 0);
  assert.equal(result.pending, 1);
  assert.equal(result.results[0].reason, 'PAPER_ENTRY_NOT_DUE');
  assert.equal(historyStore.list()[0].status, 'OPEN');
});

test('records DATA_INVALID when the frozen 30-second PAPER entry reference window is missed', () => {
  const historyStore = store([
    campaignRecord({ id: 'missed-entry', asset: 'EUR/USD', direction: 'BUY', entryPrice: 1.1, clickTime: '2026-09-14T12:00:00.000Z' })
  ]);
  const result = settleDuePaperCampaignOutcomes({
    historyStore,
    coinbaseTemporalFeeds: new Map(),
    biquoteForexFeed: { referenceAtOrAfter: () => null },
    now: Date.parse('2026-09-14T12:00:31.000Z')
  });
  assert.equal(result.settled, 1);
  assert.equal(result.dataInvalid, 1);
  assert.equal(historyStore.list()[0].outcome, 'DATA_INVALID');
  assert.equal(historyStore.list()[0].outcomeMetadata.reason, 'PAPER_ENTRY_REFERENCE_WINDOW_MISSED');
});

test('records DATA_INVALID when a confirmed PAPER entry lacks a bounded post-expiry reference', () => {
  const historyStore = store([
    campaignRecord({
      id: 'missed-exit',
      asset: 'EUR/USD',
      direction: 'BUY',
      entryPrice: 1.1,
      clickTime: '2026-09-14T12:00:00.000Z',
      execution: {
        status: 'PAPER_CONFIRMED',
        plannedClickTime: '2026-09-14T12:00:00.000Z',
        actualClickTime: '2026-09-14T12:00:02.000Z',
        actualEntryPrice: 1.101,
        paperOnly: true
      }
    })
  ]);
  const result = settleDuePaperCampaignOutcomes({
    historyStore,
    coinbaseTemporalFeeds: new Map(),
    biquoteForexFeed: { referenceAtOrAfter: () => null },
    now: Date.parse('2026-09-14T12:01:33.000Z')
  });
  assert.equal(result.settled, 1);
  assert.equal(result.dataInvalid, 1);
  assert.equal(historyStore.list()[0].outcomeMetadata.reason, 'PAPER_EXIT_REFERENCE_WINDOW_MISSED');
});

test('ignores OPEN records outside the autonomous PAPER campaign and operator-confirmed campaign records', () => {
  const legacy = campaignRecord({ id: 'legacy', asset: 'EUR/USD', direction: 'BUY', entryPrice: 1.1, clickTime: '2026-09-14T12:00:00.000Z' });
  legacy.metadata.context.monitorCycleId = null;
  const operator = campaignRecord({ id: 'operator', asset: 'EUR/USD', direction: 'BUY', entryPrice: 1.1, clickTime: '2026-09-14T12:00:00.000Z' });
  operator.execution.status = 'CONFIRMED';
  operator.execution.actualClickTime = '2026-09-14T12:00:01.000Z';
  const historyStore = store([legacy, operator]);
  const result = settleDuePaperCampaignOutcomes({
    historyStore,
    coinbaseTemporalFeeds: new Map(),
    biquoteForexFeed: null,
    now: Date.parse('2026-09-14T12:10:00.000Z')
  });
  assert.equal(result.openCampaignSignalsChecked, 0);
  assert.equal(historyStore.list().every((record) => record.status === 'OPEN'), true);
});
