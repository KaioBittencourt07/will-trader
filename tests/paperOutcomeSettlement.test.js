import assert from 'node:assert/strict';
import test from 'node:test';
import { settleDuePaperCampaignOutcomes } from '../backend/src/paperOutcomeSettlement.js';

function campaignRecord({ id, asset, direction, entryPrice, clickTime }) {
  return {
    id,
    asset,
    direction,
    entryPrice,
    clickTime,
    status: 'OPEN',
    outcome: null,
    execution: { status: 'PENDING_CONFIRMATION', plannedClickTime: clickTime, actualClickTime: null, actualEntryPrice: null },
    metadata: { context: { expirySeconds: 60, monitorCycleId: 'autonomous-paper-monitor-v1:123' } }
  };
}

function store(initial) {
  let records = structuredClone(initial);
  return {
    list: () => structuredClone(records),
    settle(id, outcome, metadata = {}) {
      const index = records.findIndex((record) => record.id === id);
      if (index < 0) throw new Error('missing');
      records[index] = { ...records[index], status: 'CLOSED', outcome, outcomeMetadata: metadata };
      return structuredClone(records[index]);
    }
  };
}

test('settles due campaign BUY and SELL with the first bounded post-expiry temporal references', () => {
  const records = [
    campaignRecord({ id: 'buy', asset: 'BTC/USD', direction: 'BUY', entryPrice: 100, clickTime: '2026-09-14T12:00:00.000Z' }),
    campaignRecord({ id: 'sell', asset: 'EUR/USD', direction: 'SELL', entryPrice: 1.2, clickTime: '2026-09-14T12:00:00.000Z' })
  ];
  const historyStore = store(records);
  const coinbaseTemporalFeeds = new Map([['BTC/USD', {
    referenceAtOrAfter: () => ({ provider: 'coinbase-exchange-ticker', price: 101, timestamp: '2026-09-14T12:01:02.000Z', lagMs: 2_000, valid: true, status: 'OK' })
  }]]);
  const biquoteForexFeed = {
    referenceAtOrAfter: () => ({ provider: 'biquote-forex', price: 1.19, timestamp: '2026-09-14T12:01:05.000Z', lagMs: 5_000, valid: true, status: 'OK' })
  };

  const result = settleDuePaperCampaignOutcomes({
    historyStore,
    coinbaseTemporalFeeds,
    biquoteForexFeed,
    now: Date.parse('2026-09-14T12:01:10.000Z')
  });

  assert.equal(result.settled, 2);
  assert.equal(result.wins, 2);
  assert.equal(result.losses, 0);
  assert.deepEqual(historyStore.list().map((record) => record.outcome), ['WIN', 'WIN']);
});

test('keeps an unexpired campaign signal pending and does not settle it early', () => {
  const historyStore = store([
    campaignRecord({ id: 'early', asset: 'BTC/USD', direction: 'BUY', entryPrice: 100, clickTime: '2026-09-14T12:00:00.000Z' })
  ]);
  const result = settleDuePaperCampaignOutcomes({
    historyStore,
    coinbaseTemporalFeeds: new Map(),
    biquoteForexFeed: null,
    now: Date.parse('2026-09-14T12:00:30.000Z')
  });
  assert.equal(result.settled, 0);
  assert.equal(result.pending, 1);
  assert.equal(historyStore.list()[0].status, 'OPEN');
});

test('records DATA_INVALID after the frozen 30-second post-expiry reference window is missed', () => {
  const historyStore = store([
    campaignRecord({ id: 'missed', asset: 'EUR/USD', direction: 'BUY', entryPrice: 1.1, clickTime: '2026-09-14T12:00:00.000Z' })
  ]);
  const result = settleDuePaperCampaignOutcomes({
    historyStore,
    coinbaseTemporalFeeds: new Map(),
    biquoteForexFeed: { referenceAtOrAfter: () => null },
    now: Date.parse('2026-09-14T12:01:31.000Z')
  });
  assert.equal(result.settled, 1);
  assert.equal(result.dataInvalid, 1);
  assert.equal(historyStore.list()[0].outcome, 'DATA_INVALID');
  assert.equal(historyStore.list()[0].outcomeMetadata.reason, 'OUTCOME_REFERENCE_WINDOW_MISSED');
});

test('ignores OPEN records outside the autonomous PAPER campaign', () => {
  const legacy = campaignRecord({ id: 'legacy', asset: 'EUR/USD', direction: 'BUY', entryPrice: 1.1, clickTime: '2026-09-14T12:00:00.000Z' });
  legacy.metadata.context.monitorCycleId = null;
  const historyStore = store([legacy]);
  const result = settleDuePaperCampaignOutcomes({
    historyStore,
    coinbaseTemporalFeeds: new Map(),
    biquoteForexFeed: null,
    now: Date.parse('2026-09-14T12:10:00.000Z')
  });
  assert.equal(result.openCampaignSignalsChecked, 0);
  assert.equal(historyStore.list()[0].status, 'OPEN');
});
