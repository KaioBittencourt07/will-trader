import assert from 'node:assert/strict';
import test from 'node:test';
import { buildScannerStudyView } from '../engine/src/scannerStudyView.js';

test('scanner study view exposes a bounded chart and allowlisted analysis fields', () => {
  const candles = Array.from({ length: 80 }, (_, index) => ({
    timestamp: new Date(Date.UTC(2026, 10, 8, 15, index)).toISOString(),
    open: 1 + index / 1000,
    high: 1.002 + index / 1000,
    low: .999 + index / 1000,
    close: 1.001 + index / 1000
  }));
  const view = buildScannerStudyView({
    asset: 'eur/usd',
    snapshot: {
      asset: 'EUR/USD', timeframe: '1min', price: 1.08,
      timestamp: '2026-11-08T16:00:00.000Z', valid: true, status: 'READY',
      source: 'twelvedata', candles, trend: .3, momentum: .4,
      structure: .2, volatility: .1, confirmations: 3,
      apiKey: 'must-not-leak', providerPayload: { secret: 'must-not-leak' }
    },
    decision: {
      direction: 'BUY', score: 72, confidence: 68, setup: 'BREAKOUT',
      regime: 'TREND', releaseEligible: true, executable: true,
      blockReasons: ['reason-a']
    },
    historyId: 'history-1'
  });

  assert.equal(view.asset, 'EUR/USD');
  assert.equal(view.candles.length, 60);
  assert.equal(view.candles[0].timestamp, candles[20].timestamp);
  assert.equal(view.decision.direction, 'BUY');
  assert.equal(view.decision.confidence, 68);
  assert.equal(view.historyId, 'history-1');
  assert.equal('apiKey' in view, false);
  assert.equal(JSON.stringify(view).includes('must-not-leak'), false);
});

test('scanner study view fails closed on invalid candles and decision values', () => {
  const view = buildScannerStudyView({
    asset: 'BTC/USD',
    snapshot: {
      price: 'not-a-price',
      candles: [
        { timestamp: 'bad', open: 1, high: 2, low: 0, close: 1 },
        { timestamp: '2026-11-08T16:00:00.000Z', open: 1, high: .5, low: 0, close: 1 }
      ]
    },
    decision: { direction: 'UNKNOWN', score: 'NaN', confidence: Infinity, blockReasons: ['x'.repeat(300)] }
  });
  assert.equal(view.price, null);
  assert.equal(view.timestamp, null);
  assert.equal(view.candles.length, 0);
  assert.equal(view.decision.direction, 'WAIT');
  assert.equal(view.decision.score, null);
  assert.equal(view.decision.confidence, null);
  assert.equal(view.decision.blockReasons[0].length, 160);
});
