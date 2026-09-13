import assert from 'node:assert/strict';
import test from 'node:test';
import { dataQualityWait } from '../engine/src/dataGuard.js';

test('data guard never turns stale data into a directional signal', () => {
  const decision = dataQualityWait({ asset: 'AAPL', timeframe: '1min', status: 'STALE', reason: 'STALE_MARKET_DATA' });
  assert.equal(decision.direction, 'WAIT');
  assert.equal(decision.executable, false);
  assert.deepEqual(decision.blockReasons, ['DATA_QUALITY_STALE_MARKET_DATA']);
});
