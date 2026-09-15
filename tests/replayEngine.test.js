import assert from 'node:assert/strict';
import test from 'node:test';
import { replayMarket, summarizeReplay } from '../engine/src/replayEngine.js';

test('replays candles chronologically', () => {
  const candles = [
    { timestamp: '2026-08-26T10:02:00Z', asset: 'EUR/USD', timeframe: '1m', price: 1.102 },
    { timestamp: '2026-08-26T10:00:00Z', asset: 'EUR/USD', timeframe: '1m', price: 1.100 },
    { timestamp: '2026-08-26T10:01:00Z', asset: 'EUR/USD', timeframe: '1m', price: 1.101 }
  ];
  const results = replayMarket({ candles });
  assert.equal(results.length, 3);
  assert.equal(results[0].timestamp, '2026-08-26T10:00:00Z');
  assert.equal(results[2].timestamp, '2026-08-26T10:02:00Z');
});

test('summarizes replay decisions', () => {
  const summary = summarizeReplay([
    { decision: { executable: true, direction: 'BUY' } },
    { decision: { executable: true, direction: 'SELL' } },
    { decision: { executable: false, direction: 'WAIT' } }
  ]);
  assert.deepEqual(summary, { candles: 3, signals: 2, buys: 1, sells: 1, waits: 1 });
});
