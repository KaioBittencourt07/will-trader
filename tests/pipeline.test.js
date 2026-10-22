import test from 'node:test';
import assert from 'node:assert/strict';
import { runWillPipeline } from '../engine/src/pipeline.js';

test('pipeline blocks when macro/news risk is active', () => {
  const result = runWillPipeline({ asset: 'TEST', timestamp: new Date().toISOString(), timeframe: '1m', price: 100, volatility: 0.2 }, { macroBlocked: true, sampleSize: 100 });
  assert.equal(result.direction, 'WAIT');
  assert.equal(result.executable, false);
  assert.equal(result.clickTime, null);
});

test('pipeline never invents a click time for WAIT', () => {
  const result = runWillPipeline({ asset: 'TEST', timestamp: new Date().toISOString(), timeframe: '1m', price: 100, volatility: 0.2 }, { dataValid: false, sampleSize: 100 });
  assert.equal(result.direction, 'WAIT');
  assert.equal(result.clickTime, null);
});

test('pipeline preserves the technical confirmation count for audit and ranking', () => {
  const result = runWillPipeline({ asset: 'TEST', timestamp: new Date().toISOString(), timeframe: '1m', price: 100, trend: 0.8, momentum: 0.7, structure: 0.75, volatility: 0.2, confirmations: 4, candleCount: 50 });
  assert.equal(result.confirmations, 4);
});

test('pipeline uses an explicitly injected replay clock without weakening live freshness defaults', () => {
  const historicalTime = '2026-10-01T12:00:00.000Z';
  const nowMs = Date.parse(historicalTime);
  const market = {
    asset: 'EUR/USD',
    timestamp: historicalTime,
    timeframe: '1min',
    price: 1.1,
    trend: 0.8,
    momentum: 0.7,
    structure: 0.8,
    volatility: 0.4,
    confirmations: 6,
    candleCount: 100
  };
  const replay = runWillPipeline(market, {
    nowMs,
    sampleSize: 100,
    minimumConfidence: 1,
    entryWindowStartSeconds: 60,
    entryWindowEndSeconds: 300,
    entryDelaySeconds: 120,
    expirySeconds: 60
  });

  assert.equal(replay.direction, 'BUY');
  assert.equal(replay.blocked, false);
  assert.equal(replay.releaseEligible, true);
  assert.equal(replay.executable, false);
  assert.equal(replay.timingStatus, 'WAIT_TIMING');
  assert.equal(replay.clickTime, new Date(nowMs + 120_000).toISOString());

  const liveClock = runWillPipeline(market, { sampleSize: 100 });
  assert.equal(liveClock.direction, 'WAIT');
  assert.equal(liveClock.blocked, true);
  assert.equal(liveClock.clickTime, null);
});

