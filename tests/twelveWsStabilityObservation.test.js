import assert from 'node:assert/strict';
import test from 'node:test';
import { observeTwelveWsStability } from '../backend/src/twelveWsStabilityObservation.js';

class Clock {
  now = 0; next = 1; tasks = new Map();
  setTimeout = (fn, ms) => this.add(fn, ms, 0); setInterval = (fn, ms) => this.add(fn, ms, ms);
  clearTimeout = (id) => this.tasks.delete(id); clearInterval = this.clearTimeout;
  add(fn, ms, interval) { const id = this.next++; this.tasks.set(id, { fn, at: this.now + ms, interval }); return id; }
  advance(ms) { const end = this.now + ms; while (true) { const due = [...this.tasks].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]; if (!due) break;
      const [id, task] = due; this.now = task.at; if (task.interval) task.at += task.interval; else this.tasks.delete(id); task.fn(); } this.now = end; }
}
class Socket {
  constructor(clock, mode) { this.clock = clock; this.mode = mode; this.listeners = {}; this.sent = []; this.closed = false; clock.setTimeout(() => this.emit('open', {}), 0); }
  addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); } emit(name, value) { for (const fn of this.listeners[name] ?? []) fn(value); }
  message(value) { this.emit('message', { data: typeof value === 'string' ? value : JSON.stringify(value) }); }
  send(raw) { const value = JSON.parse(raw); this.sent.push(value); if (value.action !== 'subscribe' || this.mode === 'no_status') return;
    this.clock.setTimeout(() => { if (this.mode === 'auth') this.message({ event: 'subscribe-status', status: 'error', message: 'api key forbidden' });
      else { this.message({ event: 'subscribe-status', status: 'ok', success: [{ symbol: 'EUR/USD' }] }); this.schedule(); } }, 10); }
  schedule() { const q = (at, timestamp) => this.clock.setTimeout(() => this.message({ event: 'price', symbol: 'EUR/USD', price: 9.9, timestamp }), at);
    if (this.mode === 'one') q(5, 100); if (this.mode === 'regular') { q(5, 100); q(20, 101); q(35, 102); }
    if (this.mode === 'gap') { q(5, 100); q(70, 101); } if (this.mode === 'out_of_order') { q(5, 200); q(20, 100); }
    if (this.mode === 'close') this.clock.setTimeout(() => this.emit('close', { code: 1006 }), 15);
    if (this.mode === 'unknown') this.clock.setTimeout(() => this.message({ event: 'mystery', token: 'SYNTHETIC_SECRET' }), 5); }
  close() { this.closed = true; }
}
async function scenario(mode, window = 100) { const clock = new Clock(); let socket;
  const promise = observeTwelveWsStability({ endpoint: 'ws://127.0.0.1:1/socket', apiKey: 'SYNTHETIC_SECRET', allowLocalSynthetic: true,
    observationWindowMs: window, preAcceptTimeoutMs: 100, heartbeatIntervalMs: 10_000, now: () => clock.now, timers: clock,
    webSocketFactory: () => (socket = new Socket(clock, mode)) }); clock.advance(20_000); return { report: await promise, socket, clock }; }

test('zero and one quote remain distinct conservative outcomes', async () => {
  assert.equal((await scenario('zero')).report.classification, 'SUBSCRIBE_ACCEPTED_NO_QUOTE_WITHIN_WINDOW');
  const one = (await scenario('one')).report; assert.equal(one.classification, 'SINGLE_QUOTE_ONLY'); assert.equal(one.quoteMessagesObserved, 1);
});
test('multiple regular quotes aggregate without stopping at first quote', async () => {
  const report = (await scenario('regular')).report; assert.equal(report.classification, 'CONTINUOUS_QUOTES_OBSERVED');
  assert.equal(report.quoteMessagesObserved, 3); assert.equal(report.firstQuoteElapsedMs, 5); assert.equal(report.lastQuoteElapsedMs, 35); assert.equal(report.maxInterQuoteGapMs, 15);
});
test('long gaps are measured but do not fabricate a stability threshold', async () => {
  const report = (await scenario('gap')).report; assert.equal(report.classification, 'CONTINUOUS_QUOTES_OBSERVED'); assert.equal(report.maxInterQuoteGapMs, 65);
});
test('event timestamp order and distinct count are aggregated without exposing values', async () => {
  const report = (await scenario('out_of_order')).report; assert.equal(report.outOfOrderEventCount, 1); assert.equal(report.distinctQuoteEventTimestampCount, 2);
  assert.equal(JSON.stringify(report).includes('200'), false); assert.equal(JSON.stringify(report).includes('9.9'), false);
});
test('heartbeat starts after acceptance and close remains fail-closed', async () => {
  const heartbeat = (await scenario('zero', 15_000)).report; assert.equal(heartbeat.heartbeatsSent, 1); assert.equal(heartbeat.applicationMessagesSent, 2);
  const closed = (await scenario('close')).report; assert.equal(closed.classification, 'POST_SUBSCRIBE_ABNORMAL_CLOSE'); assert.equal(closed.closeCode, 1006);
});
test('missing status and unknown payload are fail-closed', async () => {
  const missing = await scenario('no_status'); assert.equal(missing.report.classification, 'PRE_ACCEPT_TIMEOUT'); assert.equal(missing.report.heartbeatsSent, 0); assert.equal(missing.socket.sent.length, 1);
  const unknown = (await scenario('unknown')).report; assert.equal(unknown.classification, 'APPLICATION_PROTOCOL_INCONCLUSIVE'); assert.equal(JSON.stringify(unknown).includes('SYNTHETIC_SECRET'), false);
});
test('only explicit protocol evidence classifies auth or entitlement rejection', async () => {
  const report = (await scenario('auth')).report; assert.equal(report.classification, 'APPLICATION_AUTH_OR_ENTITLEMENT_REJECTED');
  assert.equal(report.subscribeAccepted, false); assert.equal(report.heartbeatsSent, 0);
});
test('finish cancels timers and prevents post-STOP messages', async () => {
  const { report, socket, clock } = await scenario('one'); const sent = socket.sent.length; clock.advance(60_000);
  assert.equal(socket.sent.length, sent); assert.equal(report.heartbeatsSent, 0); assert.equal(socket.closed, true);
});
test('external endpoint and unsafe budgets fail before access', async () => {
  await assert.rejects(() => observeTwelveWsStability({ apiKey: 'SYNTHETIC_SECRET' }), /NOT_AUTHORIZED/);
  await assert.rejects(() => observeTwelveWsStability({ endpoint: 'ws://127.0.0.1:1', apiKey: 'SYNTHETIC_SECRET', allowLocalSynthetic: true, preAcceptTimeoutMs: 5001 }), /PRE_ACCEPT/);
  await assert.rejects(() => observeTwelveWsStability({ endpoint: 'ws://127.0.0.1:1', apiKey: 'SYNTHETIC_SECRET', allowLocalSynthetic: true, heartbeatIntervalMs: 9999 }), /HEARTBEAT_INTERVAL/);
});
