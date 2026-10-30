import assert from 'node:assert/strict';
import test from 'node:test';
import { observeTwelveWsEventFreshness, TWELVE_WS_NATIVE_EVENT_TIMESTAMP_UNIT } from '../backend/src/twelveWsFreshnessObservation.js';
import { evaluateTwelveWsCommissioningReadiness } from '../backend/src/twelveWsCommissioningReadiness.js';

class Clock {
  now = 1_800_000_000_000; next = 1; tasks = new Map();
  setTimeout = (fn, ms) => this.add(fn, ms, 0); setInterval = (fn, ms) => this.add(fn, ms, ms);
  clearTimeout = (id) => this.tasks.delete(id); clearInterval = this.clearTimeout;
  add(fn, ms, interval) { const id = this.next++; this.tasks.set(id, { fn, at: this.now + ms, interval }); return id; }
  advance(ms) { const end = this.now + ms; while (true) { const due = [...this.tasks].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]; if (!due) break;
      const [id, task] = due; this.now = task.at; if (task.interval) task.at += task.interval; else this.tasks.delete(id); task.fn(); } this.now = end; }
}
class Socket {
  constructor(clock, timestamps) { this.clock = clock; this.timestamps = timestamps; this.listeners = {}; this.sent = []; this.closed = false; clock.setTimeout(() => this.emit('open', {}), 0); }
  addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); } emit(name, value) { for (const fn of this.listeners[name] ?? []) fn(value); }
  message(value) { this.emit('message', { data: JSON.stringify(value) }); }
  send(raw) { const value = JSON.parse(raw); this.sent.push(value); if (value.action !== 'subscribe') return;
    this.clock.setTimeout(() => { this.message({ event: 'subscribe-status', status: 'ok', success: [{ symbol: 'EUR/USD' }] });
      this.timestamps.forEach((timestamp, index) => this.clock.setTimeout(() => this.message({ event: 'price', symbol: 'EUR/USD', price: 9.9, timestamp }), 5 + index * 5)); }, 5); }
  close() { this.closed = true; }
}
async function scenario(timestamps, { unit = TWELVE_WS_NATIVE_EVENT_TIMESTAMP_UNIT, window = 100 } = {}) {
  const clock = new Clock(); let socket;
  const promise = observeTwelveWsEventFreshness({ endpoint: 'ws://127.0.0.1:1/socket', apiKey: 'SYNTHETIC_SECRET', allowLocalSynthetic: true,
    observationWindowMs: window, preAcceptTimeoutMs: 100, heartbeatIntervalMs: 10_000, eventTimestampUnit: unit,
    now: () => clock.now, timers: clock, webSocketFactory: () => (socket = new Socket(clock, timestamps)) });
  clock.advance(20_000); return { report: await promise, socket, clock };
}

test('native Twelve timestamp unit is explicit and fresh quote passes', async () => {
  assert.equal(TWELVE_WS_NATIVE_EVENT_TIMESTAMP_UNIT, 'UNIX_SECONDS');
  const { report } = await scenario([1_799_999_999.995]); assert.equal(report.classification, 'FRESHNESS_PASS_OBSERVED');
  assert.equal(report.freshnessPassCount, 1); assert.equal(report.lastEventAgeMs, 15); assert.equal(report.externalProviderCalls, 0);
});
test('inclusive 30000ms boundary passes and 30001ms fails', async () => {
  const boundary = (await scenario([1_799_999_970.01])).report; assert.equal(boundary.lastEventAgeMs, 30000); assert.equal(boundary.freshnessPassCount, 1);
  const stale = (await scenario([1_799_999_970.009])).report; assert.equal(stale.lastEventAgeMs, 30001); assert.equal(stale.classification, 'FRESHNESS_CONTRACT_FAILED');
});
test('future timestamp and ambiguous unit fail closed', async () => {
  assert.equal((await scenario([1_800_000_001])).report.classification, 'FRESHNESS_DATA_INVALID');
  const unresolved = (await scenario([1_800_000_000], { unit: null })).report;
  assert.equal(unresolved.classification, 'FRESHNESS_DATA_INVALID'); assert.equal(unresolved.freshnessEvidence.timestampUnitGate, 'FAIL');
});
test('non-finite and unsafe timestamps fail closed', async () => {
  assert.equal((await scenario(['not-finite'])).report.classification, 'FRESHNESS_DATA_INVALID');
  assert.equal((await scenario([Number.MAX_SAFE_INTEGER])).report.classification, 'FRESHNESS_DATA_INVALID');
});
test('no quote cannot create a freshness PASS', async () => {
  const { report } = await scenario([]); assert.equal(report.classification, 'NO_QUOTE_OBSERVED'); assert.equal(report.freshnessSamplesObserved, 0);
  assert.equal(report.freshnessPassCount, 0); assert.equal(report.freshnessEvidence.freshnessGate, 'UNVERIFIED');
});
test('mixed fresh and stale quotes classify conservatively', async () => {
  const { report } = await scenario([1_800_000_000, 1_799_999_960]); assert.equal(report.freshnessPassCount, 1); assert.equal(report.freshnessFailCount, 1);
  assert.equal(report.classification, 'FRESHNESS_CONTRACT_FAILED'); assert.equal(report.freshnessEvidence.freshnessGate, 'FAIL');
  assert.equal(report.timestampProgressionClassification, 'TIMESTAMP_REGRESSION_OBSERVED');
});
test('observer keeps progression separate from freshness and fails malformed timestamps closed', async () => {
  const repeated = (await scenario([1_799_999_999, 1_799_999_999, 1_800_000_000])).report;
  assert.equal(repeated.timestampProgressionClassification, 'REPEATED_TIMESTAMP_PATTERN_OBSERVED'); assert.equal(repeated.repeatedTimestampQuoteCount, 1);
  assert.equal(repeated.timestampAdvanceCount, 1); assert.equal(repeated.freshnessPassCount, 3);
  assert.equal(repeated.providerCommissioning, false); assert.equal(repeated.prospectivePaperAuthorized, false); assert.equal(repeated.ordersExecuted, 0);
  const malformed = (await scenario([1_800_000_000, 'bad'])).report;
  assert.equal(malformed.timestampProgressionClassification, 'DATA_INVALID'); assert.equal(malformed.freshnessInvalidCount, 1);
});
test('sanitized output contains no absolute timestamp, price, URL or secret', async () => {
  const text = JSON.stringify((await scenario([1_800_000_000])).report);
  for (const forbidden of ['1800000000', '9.9', 'SYNTHETIC_SECRET', 'apikey=', 'ws://']) assert.equal(text.includes(forbidden), false);
});
test('positive freshness evidence cannot promote commissioning or PAPER', async () => {
  const { report } = await scenario([1_800_000_000]); const readiness = evaluateTwelveWsCommissioningReadiness([], report.freshnessEvidence);
  assert.equal(readiness.freshnessCompatibilityGate, 'PASS'); assert.equal(readiness.providerCommissioning, false);
  assert.equal(readiness.prospectivePaperAuthorized, false); assert.equal(readiness.ordersExecuted, 0);
});
test('observer uses one connection and one subscription with no retry or reconnect', async () => {
  const { report, socket, clock } = await scenario([1_800_000_000]); const sent = socket.sent.length; clock.advance(60_000);
  assert.equal(report.connections, 1); assert.equal(report.subscribeAttempts, 1); assert.equal(report.retries, 0); assert.equal(report.reconnects, 0);
  assert.equal(socket.sent.filter((value) => value.action === 'subscribe').length, 1); assert.equal(socket.sent.length, sent); assert.equal(socket.closed, true);
});
test('external target and unsafe bounded settings stop before access', async () => {
  await assert.rejects(() => observeTwelveWsEventFreshness({ apiKey: 'SYNTHETIC_SECRET' }), /NOT_AUTHORIZED/);
  await assert.rejects(() => observeTwelveWsEventFreshness({ endpoint: 'ws://127.0.0.1:1', apiKey: 'SYNTHETIC_SECRET', allowLocalSynthetic: true, observationWindowMs: 60001 }), /WINDOW_INVALID/);
});
