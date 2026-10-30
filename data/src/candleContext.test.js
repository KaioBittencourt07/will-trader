import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCandleContext } from './candleContext.js';

test('builds ordered candle context', () => {
  const candles = [
    {timestamp:'2026-08-26T10:02:00Z',open:2,high:3,low:1.5,close:2.5},
    {timestamp:'2026-08-26T10:01:00Z',open:1,high:2.2,low:.8,close:2},
    {timestamp:'2026-08-26T10:03:00Z',open:2.5,high:3.2,low:2.4,close:3}
  ];
  const result=buildCandleContext(candles);
  assert.equal(result.valid,true); assert.equal(result.count,3); assert.equal(result.lastClose,3); assert.equal(result.candles[0].close,2);
});

test('rejects malformed candles', () => assert.equal(buildCandleContext([{timestamp:'bad',open:1,high:2,low:0,close:1}]).valid,false));
