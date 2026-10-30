import assert from 'node:assert/strict';
import test from 'node:test';
import { createPaperOrder, closePaperOrder } from '../paper/src/paperEngine.js';

test('WAIT cannot create a paper order', () => {
  const result = createPaperOrder({ direction: 'WAIT', blocked: true });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.stake, 0);
});

test('paper order requires valid close outcome', () => {
  const order = createPaperOrder({ direction: 'BUY', blocked: false, asset: 'TEST', timeframe: '1m', price: 100 });
  assert.equal(order.status, 'OPEN');
  const closed = closePaperOrder(order, 'WIN', 101);
  assert.equal(closed.status, 'CLOSED');
  assert.equal(closed.outcome, 'WIN');
});
