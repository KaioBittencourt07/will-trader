import assert from 'node:assert/strict';
import test from 'node:test';
import { createAvalonReadOnlyFeed } from '../data/src/providers/avalonReadOnlyFeed.js';

const validEvent = (overrides = {}) => ({
  name: 'candle-generated',
  msg: {
    active_id: 1857, size: 60, id: 991,
    at: 1794153600000000000, from: 1794153540000000000, to: 1794153600000000000,
    open: 1.08, max: 1.081, min: 1.079, close: 1.0805,
    bid: 1.0804, ask: 1.0806, volume: 12, phase: 'active',
    ...overrides
  }
});

test('Avalon read-only feed accepts sanitized OHLC and quote events in shadow mode', () => {
  let nowMs = 1_794_153_600_000;
  const feed = createAvalonReadOnlyFeed({ now: () => nowMs });
  assert.deepEqual(feed.ingest({ name: 'timeSync', msg: 1_794_153_600_000 }), { accepted: true, kind: 'timeSync' });
  nowMs += 250;
  assert.deepEqual(feed.ingest(validEvent()), { accepted: true, kind: 'candle-generated', activeId: 1857 });

  const snapshot = feed.getSnapshot();
  assert.equal(snapshot.mode, 'SHADOW_ONLY');
  assert.equal(snapshot.state, 'RECEIVING');
  assert.deepEqual(snapshot.activeIds, [1857]);
  assert.equal(snapshot.assets[0].timestampUnit, 'UNVERIFIED');
  assert.equal(snapshot.assets[0].serverTimeRaw, 1_794_153_600_000);
  assert.equal(snapshot.assets[0].receivedAtMs, nowMs);
  assert.equal(feed.health().latestQuotes[0].close, 1.0805);
  assert.equal(feed.health().latestQuotes[0].activeId, 1857);
  assert.equal(feed.health().decisionImpact, 'NONE');
  assert.equal(feed.health().ordersExecuted, 0);
});

test('Avalon feed rejects invalid OHLC, crossed spread, and unknown active IDs', () => {
  const feed = createAvalonReadOnlyFeed();
  assert.equal(feed.ingest(validEvent({ active_id: 0 })).reason, 'ACTIVE_ID_INVALID');
  assert.equal(feed.ingest(validEvent({ max: 1.07 })).reason, 'OHLC_INCONSISTENT');
  assert.equal(feed.ingest(validEvent({ ask: 1.079 })).reason, 'SPREAD_INCONSISTENT');
  assert.equal(feed.ingest(validEvent({ close: 'NaN' })).reason, 'OHLC_OR_QUOTE_NON_FINITE');
  assert.equal(feed.getSnapshot().assets.length, 0);
  assert.equal(feed.health().rejectedMessages, 4);
});

test('Avalon feed ignores unrelated events and never assumes provider timestamp units', () => {
  const feed = createAvalonReadOnlyFeed();
  assert.deepEqual(feed.ingest({ name: 'quotes', msg: { token: 'must-not-be-stored' } }), {
    accepted: false, ignored: true, reason: 'EVENT_NOT_SUPPORTED'
  });
  assert.equal(feed.ingest({ name: 'timeSync', msg: 'invalid' }).reason, 'TIMESYNC_INVALID');
  assert.equal(feed.health().ignoredMessages, 1);
  assert.equal(feed.health().rejectedMessages, 1);
  assert.equal(feed.getSnapshot().assets.length, 0);
});
