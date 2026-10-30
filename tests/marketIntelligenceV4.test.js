import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChatMarketPacket, buildMarketIntelligence } from '../context/src/marketIntelligenceV4.js';

const fresh = { status: 'FRESH', ageMs: 1_000 };

test('keeps unknown macro/news explicit instead of treating missing context as safe', () => {
  const intelligence = buildMarketIntelligence({
    asset: 'BTC/USD',
    marketContext: {
      asset: 'BTC/USD',
      macro: { status: 'MACRO_UNKNOWN', blocked: false, source: null, freshness: { status: 'UNKNOWN', ageMs: null }, events: [] },
      news: { status: 'NEWS_UNKNOWN', blocked: false, source: null, freshness: { status: 'UNKNOWN', ageMs: null }, events: [] }
    }
  });
  assert.equal(intelligence.coverage, 'UNKNOWN');
  assert.equal(intelligence.hardBlocked, false);
  assert.equal(intelligence.decisionPolicy.unknownContextIsSafe, false);
  assert.deepEqual(intelligence.degradations, ['MACRO_CONTEXT_UNAVAILABLE_OR_STALE', 'NEWS_CONTEXT_UNAVAILABLE_OR_STALE']);
});

test('high-impact verified macro context becomes an explicit hard block without creating direction', () => {
  const intelligence = buildMarketIntelligence({
    asset: 'BTC/USD',
    marketContext: {
      asset: 'BTC/USD',
      macro: {
        status: 'HIGH', blocked: true, source: 'official-calendar', freshness: fresh,
        events: [{ name: 'FOMC', timestamp: '2026-09-16T18:00:00.000Z', impact: 'HIGH', currency: 'USD', source: 'official-calendar' }]
      },
      news: { status: 'NEWS_OK', blocked: false, source: 'verified-news', freshness: fresh, events: [] }
    }
  });
  assert.equal(intelligence.coverage, 'FULL');
  assert.equal(intelligence.hardBlocked, true);
  assert.ok(intelligence.hardBlocks.includes('MACRO_HIGH_IMPACT_WINDOW'));
  assert.equal(intelligence.decisionPolicy.aiMayCreateDirection, false);
  assert.equal(intelligence.ordersExecuted, 0);
});

test('chat packet reuses the same intelligence truth and is explanation-only', () => {
  const marketContext = {
    asset: 'BTC/USD',
    macro: { status: 'LOW', blocked: false, source: 'macro-source', freshness: fresh, events: [] },
    news: { status: 'NEWS_OK', blocked: false, source: 'news-source', freshness: fresh, events: [] }
  };
  const packet = buildChatMarketPacket({ asset: 'BTC/USD', marketContext, scanner: { state: 'CANDIDATE_AVAILABLE' } });
  assert.equal(packet.intelligence.coverage, 'FULL');
  assert.equal(packet.scanner.state, 'CANDIDATE_AVAILABLE');
  assert.equal(packet.decisionImpact, 'EXPLANATION_ONLY');
  assert.ok(packet.instructions.includes('DO_NOT_CREATE_BUY_OR_SELL_DIRECTION'));
});
