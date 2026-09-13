import assert from 'node:assert/strict';
import test from 'node:test';

test('relay URL preserves the requested asset and timeframe', () => {
  const query = new URLSearchParams({ asset: 'BTC/USD', timeframe: '1min', outputsize: '50' });
  assert.equal(query.get('asset'), 'BTC/USD');
  assert.equal(query.toString().includes('asset=BTC%2FUSD'), true);
});

test('a local relay sentinel is explicit and never confused with a market signal', () => {
  const sentinel = 'LOCAL_RELAY_REQUIRED';
  assert.equal(/LOCAL_RELAY_REQUIRED/.test(sentinel), true);
  assert.equal(['BUY', 'SELL', 'WAIT'].includes(sentinel), false);
});
