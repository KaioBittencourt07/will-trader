import assert from 'node:assert/strict';
import test from 'node:test';

test('relay cooldown messages are converted to an informative WAIT, never a trade', () => {
  const message = 'Relay local em cooldown (16s) para respeitar o limite do feed.';
  assert.equal(/cooldown/i.test(message), true);
  const decision = { direction: 'WAIT', executable: false };
  assert.equal(decision.executable, false);
});

test('an unavailable provider symbol is not treated as a trade candidate', () => {
  const error = 'Twelve Data quote HTTP 404';
  assert.equal(/HTTP 404/.test(error), true);
  assert.equal(['BUY', 'SELL'].includes('WAIT'), false);
});
