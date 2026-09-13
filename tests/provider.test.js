import assert from 'node:assert/strict';
import test from 'node:test';
import { createManualProvider } from '../data/src/provider.js';

test('provider normalizes a valid snapshot', async () => {
  const timestamp = new Date().toISOString();
  const provider = createManualProvider({ asset: 'EUR/USD', timeframe: '1m', price: 1.17, timestamp });
  const snapshot = await provider.getSnapshot('EUR/USD', '1m');
  assert.equal(snapshot.valid, true);
  assert.equal(snapshot.status, 'OK');
});

test('provider blocks invalid snapshot', async () => {
  const provider = createManualProvider({ asset: 'EUR/USD', timeframe: '1m', price: 0, timestamp: new Date().toISOString() });
  const snapshot = await provider.getSnapshot('EUR/USD', '1m');
  assert.equal(snapshot.valid, false);
  assert.equal(snapshot.status, 'INVALID');
});
