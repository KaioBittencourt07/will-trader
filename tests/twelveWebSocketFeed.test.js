import test from 'node:test';
import assert from 'node:assert/strict';
import { createTwelveWebSocketFeed } from '../data/src/providers/twelveWebSocketFeed.js';

class MockWebSocket {
  OPEN = 1;
  readyState = 0;
  sent = [];
  listeners = new Map();
  closed = false;
  addEventListener(event, handler) {
    this.listeners.set(event, [...(this.listeners.get(event) || []), handler]);
  }
  emit(event, value = {}) {
    for (const handler of this.listeners.get(event) || []) handler(value);
  }
  open() { this.readyState = 1; this.emit('open'); }
  message(payload) { this.emit('message', { data: JSON.stringify(payload) }); }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.closed = true; this.readyState = 3; this.emit('close'); }
}

function harness(overrides = {}) {
  let currentTime = 1_700_000_000_000;
  let nextTimerId = 1;
  const timers = new Map();
  const sockets = [];
  const feed = createTwelveWebSocketFeed({
    enabled: true,
    apiKey: 'secret-key',
    symbols: ['EUR/USD', 'EUR/USD', 'BTC/USD'],
    now: () => currentTime,
    webSocketFactory: (url) => {
      const socket = new MockWebSocket();
      socket.url = url;
      sockets.push(socket);
      return socket;
    },
    setTimer: (callback, delay) => {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    ...overrides
  });
  return {
    feed, sockets, timers,
    advance: (ms) => { currentTime += ms; },
    runTimer: (id) => {
      const timer = timers.get(id);
      timers.delete(id);
      timer.callback();
    }
  };
}

test('uses one central connection, subscribes controlled symbols and sends heartbeat', () => {
  const h = harness();
  assert.equal(h.feed.start(), true);
  assert.equal(h.feed.start(), false);
  assert.equal(h.sockets.length, 1);
  assert.match(h.sockets[0].url, /^wss:\/\/ws\.twelvedata\.com\/v1\/quotes\/price\?apikey=/);
  h.sockets[0].open();
  assert.deepEqual(h.sockets[0].sent[0], { action: 'subscribe', params: { symbols: 'EUR/USD,BTC/USD' } });
  h.sockets[0].message({ event: 'subscribe-status', status: 'ok', success: [{ symbol: 'EUR/USD' }, { symbol: 'BTC/USD' }], fails: [] });
  h.runTimer([...h.timers.keys()][0]);
  assert.deepEqual(h.sockets[0].sent[1], { action: 'heartbeat' });
  assert.equal(h.feed.health().heartbeatSent, 1);
  assert.equal(h.feed.health().successfulConnections, 1);
  assert.equal(h.feed.health().subscriptionsRequested, 2);
  assert.equal(h.feed.health().subscriptionsAccepted, 2);
  assert.equal(h.feed.health().activeSymbols, 2);
});

test('deduplicates ticks, records timestamps and detects gaps without building candles', () => {
  const h = harness({ gapAfterMs: 5_000 });
  h.feed.start();
  h.sockets[0].open();
  h.sockets[0].message({ event: 'price', symbol: 'EUR/USD', price: '1.10', timestamp: 1_700_000_000 });
  h.sockets[0].message({ event: 'price', symbol: 'EUR/USD', price: '1.10', timestamp: 1_700_000_000 });
  h.advance(7_000);
  h.sockets[0].message({ event: 'price', symbol: 'EUR/USD', price: '1.11', timestamp: 1_700_000_007 });
  const health = h.feed.health();
  assert.equal(health.messagesReceived, 3);
  assert.equal(health.ticksAccepted, 2);
  assert.equal(health.duplicates, 1);
  assert.equal(health.gaps, 1);
  assert.equal(health.authoritativeCandlesBuilt, 0);
  assert.equal(health.decisionImpact, 'NONE');
  assert.equal(health.restReductionPotential.requestsAvoided, 0);
  assert.equal(health.firstTickAt, '2023-11-14T22:13:20.000Z');
  assert.equal(health.lastTickAt, '2023-11-14T22:13:27.000Z');
  assert.deepEqual(health.providerConsumption, {
    restCreditsConsumedByFeed: 0, wsCreditsEstimated: 0, wsCreditsEstimatedIsOfficial: false
  });
});

test('records accepted and rejected subscriptions without exposing provider secrets', () => {
  const h = harness();
  h.feed.start();
  h.sockets[0].open();
  h.sockets[0].message({
    event: 'subscribe-status', status: 'warning', success: ['EUR/USD'],
    fails: [{ symbol: 'BTC/USD' }], message: 'apikey=secret-key plan limit'
  });
  const health = h.feed.health();
  assert.equal(health.subscriptionsAccepted, 1);
  assert.equal(health.subscriptionsRejected, 1);
  assert.equal(health.activeSymbols, 1);
  assert.equal(health.lastSubscriptionStatus, 'WARNING');
  assert.equal(JSON.stringify(health).includes('secret-key'), false);
  assert.equal(health.providerConsumption.restCreditsConsumedByFeed, 0);
});

test('reports fresh and stale health deterministically', () => {
  const h = harness({ staleAfterMs: 1_000 });
  h.feed.start();
  h.sockets[0].open();
  h.sockets[0].message({ event: 'price', symbol: 'BTC/USD', price: 50_000, timestamp: 1_700_000_000 });
  assert.equal(h.feed.health().available, true);
  h.advance(1_001);
  assert.equal(h.feed.health().available, false);
});

test('reconnects with bounded exponential backoff', () => {
  const h = harness({ reconnectBaseMs: 100, reconnectMaxMs: 200 });
  h.feed.start();
  h.sockets[0].open();
  h.sockets[0].emit('close', { code: 1006, reason: 'temporary network loss' });
  let id = [...h.timers.entries()].find(([, timer]) => timer.delay === 100)?.[0];
  h.runTimer(id);
  h.sockets[1].emit('close');
  id = [...h.timers.entries()].find(([, timer]) => timer.delay === 200)?.[0];
  h.runTimer(id);
  assert.equal(h.sockets.length, 3);
  assert.equal(h.feed.health().reconnects, 2);
  assert.equal(h.feed.health().lastReconnectBackoffMs, 200);
  assert.equal(h.feed.health().reconnectBackoffMsTotal, 300);
  assert.equal(h.feed.health().lastDisconnectCode, 1006);
});

test('shutdown closes socket, cancels timers and disabled mode is inert', () => {
  const h = harness();
  h.feed.start();
  h.sockets[0].open();
  h.feed.stop();
  assert.equal(h.sockets[0].closed, true);
  assert.equal(h.timers.size, 0);
  assert.equal(h.feed.health().state, 'STOPPED');
  const disabled = createTwelveWebSocketFeed({ enabled: false, apiKey: 'do-not-expose', symbols: 'EUR/USD' });
  assert.equal(disabled.start(), false);
  assert.equal(JSON.stringify(disabled.health()).includes('do-not-expose'), false);
});
