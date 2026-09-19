import assert from 'node:assert/strict';
import test from 'node:test';
import { observeTwelveHeartbeatSession } from '../backend/src/twelveHeartbeatObservation.js';

class SyntheticSocket {
  constructor(mode) { this.mode = mode; this.listeners = {}; this.sent = []; this.closed = false; setImmediate(() => this.emit('open', {})); }
  addEventListener(name, callback) { (this.listeners[name] ??= []).push(callback); }
  emit(name, value) { for (const callback of this.listeners[name] ?? []) callback(value); }
  message(payload) { this.emit('message', { data: JSON.stringify(payload) }); }
  send(raw) {
    const payload = JSON.parse(raw); this.sent.push(payload);
    if (payload.action === 'subscribe' && this.mode !== 'no_status') setImmediate(() => {
      this.message({ event: 'subscribe-status', status: 'ok', success: [{ symbol: 'EUR/USD' }] });
      if (this.mode === 'before') setTimeout(() => this.message({ event: 'price', symbol: 'EUR/USD', price: 9.9, timestamp: 1 }), 5);
      if (this.mode === 'close') setTimeout(() => this.emit('close', { code: 1006 }), 10);
      if (this.mode === 'incoming') { this.message({ event: 'heartbeat' }); this.message({ event: 'control' }); this.message({ event: 'mystery', token: 'SYNTHETIC_SECRET' }); }
    });
    if (payload.action === 'heartbeat' && this.mode === 'after' && this.sent.filter((item) => item.action === 'heartbeat').length === 2) setImmediate(() => this.message({ event: 'price', symbol: 'EUR/USD', price: 9.9, timestamp: 1 }));
    if (payload.action === 'heartbeat' && this.mode === 'incoming' && this.sent.filter((item) => item.action === 'heartbeat').length === 2) setImmediate(() => this.message({ event: 'price', symbol: 'EUR/USD', price: 9.9, timestamp: 1 }));
  }
  close() { this.closed = true; }
}

async function scenario(mode, overrides = {}) {
  let socket; const report = await observeTwelveHeartbeatSession({ endpoint: 'ws://127.0.0.1:1/socket', apiKey: 'SYNTHETIC_SECRET', allowLocalSynthetic: true,
    observationWindowMs: 100, preAcceptTimeoutMs: 100, heartbeatIntervalMs: 20,
    webSocketFactory: () => (socket = new SyntheticSocket(mode)), ...overrides });
  return { report, socket };
}

test('quote before first heartbeat ends a one-connection one-subscribe session', async () => {
  const { report, socket } = await scenario('before'); assert.equal(report.classification, 'QUOTE_OBSERVED_WITH_HEARTBEAT_SESSION');
  assert.equal(report.heartbeatsSent, 0); assert.deepEqual(socket.sent, [{ action: 'subscribe', params: { symbols: 'EUR/USD' } }]);
});

test('quote after heartbeats is observed without claiming heartbeat causality', async () => {
  const { report, socket } = await scenario('after', { observationWindowMs: 500 }); assert.equal(report.classification, 'QUOTE_OBSERVED_WITH_HEARTBEAT_SESSION');
  assert.equal(report.causeConfirmed, true); assert.equal(report.heartbeatsSent, 2); assert.equal(socket.sent.filter((x) => x.action === 'subscribe').length, 1);
});

test('silence sends bounded heartbeats until timeout and remains causally unknown', async () => {
  const { report } = await scenario('silent'); assert.equal(report.classification, 'SUBSCRIBE_ACCEPTED_NO_QUOTE_WITH_HEARTBEATS');
  assert.equal(report.causeConfirmed, false); assert.ok(report.heartbeatsSent >= 1); assert.equal(report.retries, 0); assert.equal(report.reconnects, 0);
});

test('close after accepted subscribe is fail-closed', async () => {
  const { report } = await scenario('close'); assert.equal(report.classification, 'POST_SUBSCRIBE_ABNORMAL_CLOSE'); assert.equal(report.closeCode, 1006); assert.equal(report.causeConfirmed, false);
});

test('incoming control and unknown messages can precede a quote without secret exposure', async () => {
  const { report } = await scenario('incoming', { observationWindowMs: 500 }); assert.equal(report.classification, 'QUOTE_OBSERVED_WITH_HEARTBEAT_SESSION'); assert.equal(report.nonPriceMessagesObserved, 4);
  assert.equal(JSON.stringify(report).includes('SYNTHETIC_SECRET'), false); assert.equal(JSON.stringify(report).includes('9.9'), false);
});

test('missing subscribe status times out before heartbeat and without second subscribe', async () => {
  const { report, socket } = await scenario('no_status'); assert.equal(report.classification, 'PRE_ACCEPT_TIMEOUT'); assert.equal(report.heartbeatsSent, 0);
  assert.equal(socket.sent.length, 1); assert.equal(report.subscribeAttempts, 1); assert.equal(report.applicationMessagesSent, 1);
});

test('finish cancels timers and prevents heartbeat after stop', async () => {
  const { report, socket } = await scenario('before'); const sent = socket.sent.length; await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(socket.sent.length, sent); assert.equal(report.heartbeatsSent, 0); assert.equal(socket.closed, true);
});

test('external use requires future authorization and enforces ten-second heartbeat floor', async () => {
  await assert.rejects(() => observeTwelveHeartbeatSession({ apiKey: 'SYNTHETIC_SECRET' }), /NOT_AUTHORIZED/);
  await assert.rejects(() => observeTwelveHeartbeatSession({ apiKey: 'SYNTHETIC_SECRET', authorization: 'R8D_HEARTBEAT_OBSERVATION_EXPLICITLY_AUTHORIZED', heartbeatIntervalMs: 9_999 }), /INTERVAL_INVALID/);
});
