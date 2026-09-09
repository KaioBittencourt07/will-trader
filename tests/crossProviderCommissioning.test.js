import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSaxoSubscriptionBody, commissioningConfiguration, describeWebSocketRuntime, extractSaxoSubscriptionSnapshot, runCrossProviderCommissioning } from '../backend/src/crossProviderCommissioning.js';
import { transformSaxoChartsOffline } from '../data/src/providers/saxoQualification.js';

const NOW = Date.parse('2026-09-09T20:00:20Z');
const env = { WILL_CROSS_PROVIDER_COMMISSIONING_ENABLED: 'true', WILL_CROSS_PROVIDER_AUTHORIZATION: '13B_EXPLICITLY_AUTHORIZED',
  WILL_SAXO_ENVIRONMENT: 'sim', WILL_SAXO_ACCESS_TOKEN: 'synthetic-saxo', TWELVE_DATA_API_KEY: 'synthetic-twelve' };
const saxo = () => transformSaxoChartsOffline({ chartResponse: { ChartInfo: { Horizon: 1, FirstSampleTime: '2020-01-01T00:00:00Z' }, DataVersion: 1,
  Data: [{ Time: '2026-09-09T19:59:00Z', Open: 1.17, High: 1.171, Low: 1.169, Close: 1.1705 }] }, sampleEvidence: 'SUBSCRIPTION_INITIAL_SNAPSHOT', receivedAt: new Date(NOW).toISOString() });

class Socket {
  static OPEN = 1; OPEN = 1; readyState = 0; listeners = {};
  addEventListener(name, fn) { this.listeners[name] = fn; }
  send(payload) { if (JSON.parse(payload).action === 'subscribe') {
    this.listeners.message({ data: JSON.stringify({ event: 'subscribe-status', status: 'ok', success: [{ symbol: 'EUR/USD' }] }) });
    this.listeners.message({ data: JSON.stringify({ event: 'price', symbol: 'EUR/USD', price: 1.1706, timestamp: (NOW - 5_000) / 1000 }) });
  } }
  open() { this.readyState = 1; this.listeners.open(); }
  close() { this.readyState = 3; }
}

test('missing credentials fail before all external access', async () => {
  let called = 0;
  const report = await runCrossProviderCommissioning({ env: {}, fetchImpl: async () => { called += 1; } });
  assert.equal(report.result, 'BLOCKED_EXTERNAL'); assert.equal(report.sessions, 0); assert.equal(called, 0);
  assert.equal(report.stoppedBeforeExternalAccess, true);
});

test('only Saxo SIM and exact 13B authorization pass configuration', () => {
  assert.equal(commissioningConfiguration(env).ready, true);
  assert.ok(commissioningConfiguration({ ...env, WILL_SAXO_ENVIRONMENT: 'live' }).reasonCodes.includes('SAXO_SIM_REQUIRED'));
});

test('missing WebSocket runtime fails before Saxo or Twelve access without reconnect loop', async () => {
  let saxoCalls = 0;
  const report = await runCrossProviderCommissioning({ env, webSocketFactory: null, saxoSubscribe: async () => { saxoCalls += 1; } });
  assert.equal(report.result, 'BLOCKED_EXTERNAL');
  assert.deepEqual(report.reasonCodes, ['TWELVE_WEBSOCKET_RUNTIME_UNAVAILABLE']);
  assert.equal(report.twelve.reconnects, 0); assert.equal(report.sessions, 0); assert.equal(saxoCalls, 0);
});

test('bounded synthetic commissioning passes without decision authority', async () => {
  let socket;
  const report = await runCrossProviderCommissioning({ env, now: () => NOW, wait: async () => {},
    webSocketFactory: () => { socket = new Socket(); queueMicrotask(() => socket.open()); return socket; }, saxoSubscribe: async () => saxo() });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(report.result, 'READONLY_COMMISSIONING_PASSED');
  assert.equal(report.sessions, 1); assert.equal(report.ordersExecuted, 0); assert.equal(report.decisionImpact, 'NONE');
  assert.equal(report.prospectivePaperAuthorized, false); assert.equal(report.gateMs, 30_000);
});

test('Saxo unavailable or ambiguous fails closed', async () => {
  const report = await runCrossProviderCommissioning({ env, now: () => NOW, wait: async () => {},
    webSocketFactory: () => { const socket = new Socket(); queueMicrotask(() => socket.open()); return socket; },
    saxoSubscribe: async () => { const error = new Error('forbidden'); error.status = 403; throw error; } });
  assert.equal(report.result, 'BLOCKED_EXTERNAL'); assert.ok(report.reasonCodes.includes('SAXO_MISCONFIGURED'));
});

test('sanitized result never contains credential values', async () => {
  const report = await runCrossProviderCommissioning({ env: { ...env, WILL_CROSS_PROVIDER_COMMISSIONING_ENABLED: 'false' } });
  const text = JSON.stringify(report); assert.equal(text.includes('synthetic-saxo'), false); assert.equal(text.includes('synthetic-twelve'), false);
});

test('Saxo subscription wrapper and requested ChartInfo preserve exact Horizon 1', async () => {
  const body = { Snapshot: { ChartInfo: { Horizon: 1, FirstSampleTime: '2020-01-01T00:00:00Z' }, DataVersion: 1,
    Data: [{ Time: '2026-09-09T19:59:00Z', Open: 1.17, High: 1.171, Low: 1.169, Close: 1.1705 }] } };
  assert.equal(extractSaxoSubscriptionSnapshot(body).ChartInfo.Horizon, 1);
  assert.throws(() => extractSaxoSubscriptionSnapshot(body.Snapshot), /SAXO_SUBSCRIPTION_SNAPSHOT_MISSING/);
  assert.throws(() => transformSaxoChartsOffline({ chartResponse: { ...body.Snapshot, ChartInfo: { ...body.Snapshot.ChartInfo, Horizon: 5 } },
    sampleEvidence: 'SUBSCRIPTION_INITIAL_SNAPSHOT', receivedAt: new Date(NOW).toISOString() }), /SAXO_RESPONSE_TIMEFRAME_MISMATCH/);
});

test('Saxo request explicitly asks for documentary Data and ChartInfo groups', () => {
  const body = buildSaxoSubscriptionBody({ contextId: 'ctx', referenceId: 'ref' });
  assert.equal(body.Arguments.Horizon, 1);
  assert.equal(body.Arguments.ChartSampleFieldSet, 'Default');
  assert.deepEqual(body.Arguments.FieldGroups, ['ChartInfo', 'Data']);
});

test('missing Twelve quote remains BLOCKED_EXTERNAL', async () => {
  class NoQuoteSocket extends Socket { send(payload) { if (JSON.parse(payload).action === 'subscribe')
    this.listeners.message({ data: JSON.stringify({ event: 'subscribe-status', status: 'ok', success: [{ symbol: 'EUR/USD' }] }) }); } }
  const report = await runCrossProviderCommissioning({ env, now: () => NOW, wait: async () => {},
    webSocketFactory: () => { const socket = new NoQuoteSocket(); queueMicrotask(() => socket.open()); return socket; }, saxoSubscribe: async () => saxo() });
  assert.equal(report.result, 'BLOCKED_EXTERNAL'); assert.equal(report.composition.state, 'INVALID');
  assert.ok(report.reasonCodes.includes('QUOTE_TIMESTAMP_INVALID'));
});

test('WebSocket runtime diagnostic is local and contains no credentials', () => {
  class NativeLikeWebSocket {}
  const diagnostic = describeWebSocketRuntime(NativeLikeWebSocket);
  assert.deepEqual([diagnostic.available, diagnostic.api, diagnostic.implementation], [true, 'EVENT_TARGET_WEBSOCKET', 'NativeLikeWebSocket']);
  assert.equal(diagnostic.secretExposed, false);
});
