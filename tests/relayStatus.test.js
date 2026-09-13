import assert from 'node:assert/strict';
import test from 'node:test';
import { getLocalRelayStatus } from '../backend/src/routes/market.js';

test('relay status exposes telemetry without making a market request', () => {
  const status = getLocalRelayStatus();
  assert.equal(typeof status.cacheEntries, 'number');
  assert.equal(typeof status.coolingDown, 'boolean');
  assert.equal(['DIRECT_OR_IDLE', 'LOCAL_RELAY'].includes(status.mode), true);
});
