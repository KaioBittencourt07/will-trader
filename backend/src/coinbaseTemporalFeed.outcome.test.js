import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoinbaseTemporalFeed } from './coinbaseTemporalFeed.js';

function fakeSocket() {
  const listeners = new Map();
  return {
    sent: [],
    addEventListener(event, handler) { listeners.set(event, handler); },
    send(value) { this.sent.push(value); },
    close() {},
    emit(event, payload = {}) { listeners.get(event)?.(payload); }
  };
}

test('retains the earliest Coinbase tick inside the frozen 30-second post-expiry window', () => {
  const socket = fakeSocket();
  const current = Date.parse('2026-09-14T12:01:05.000Z');
  const feed = createCoinbaseTemporalFeed({
    enabled: true,
    symbol: 'BTC/USD',
    now: () => current,
    webSocketFactory: () => socket
  });

  assert.equal(feed.start(), true);
  socket.emit('open');
  socket.emit('message', { data: JSON.stringify({
    type: 'ticker',
    product_id: 'BTC-USD',
    time: '2026-09-14T12:01:02.000Z',
    price: '101.25',
    sequence: 1,
    trade_id: 1
  }) });

  const reference = feed.referenceAtOrAfter('2026-09-14T12:01:00.000Z');
  assert.equal(reference.provider, 'coinbase-exchange-ticker');
  assert.equal(reference.symbol, 'BTC/USD');
  assert.equal(reference.price, 101.25);
  assert.equal(reference.timestamp, '2026-09-14T12:01:02.000Z');
  assert.equal(reference.lagMs, 2_000);
  assert.equal(feed.referenceAtOrAfter('2026-09-14T12:01:00.000Z', 60_000), null);

  feed.stop();
});

test('does not reuse a Coinbase tick that occurred before expiry or after the frozen reference window', () => {
  const socket = fakeSocket();
  const current = Date.parse('2026-09-14T12:01:40.000Z');
  const feed = createCoinbaseTemporalFeed({
    enabled: true,
    symbol: 'BTC/USD',
    now: () => current,
    webSocketFactory: () => socket
  });

  feed.start();
  socket.emit('open');
  for (const [time, price, sequence] of [
    ['2026-09-14T12:00:59.900Z', '100', 1],
    ['2026-09-14T12:01:31.000Z', '102', 2]
  ]) {
    socket.emit('message', { data: JSON.stringify({
      type: 'ticker', product_id: 'BTC-USD', time, price, sequence, trade_id: sequence
    }) });
  }

  assert.equal(feed.referenceAtOrAfter('2026-09-14T12:01:00.000Z'), null);
  feed.stop();
});
