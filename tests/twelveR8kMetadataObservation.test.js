import assert from 'node:assert/strict';
import test from 'node:test';
import {
  observeTwelveR8kMetadata,
  TWELVE_R8K_METADATA_AUTHORIZATION
} from '../backend/src/twelveR8kMetadataObservation.js';

function harness() {
  const listeners = new Map();
  const sent = [];
  const timeouts = [];
  const intervals = [];
  const socket = {
    addEventListener(name, fn) { listeners.set(name, fn); },
    send(value) { sent.push(JSON.parse(value)); },
    close() {}
  };
  const timers = {
    setTimeout(fn) { timeouts.push(fn); return fn; },
    clearTimeout() {},
    setInterval(fn) { intervals.push(fn); return fn; },
    clearInterval() {}
  };
  return { listeners, sent, timeouts, intervals, socket, timers };
}

const base = {
  apiKey: 'local-secret',
  authorization: TWELVE_R8K_METADATA_AUTHORIZATION,
  symbol: 'EUR/USD',
  observationWindowMs: 60_000,
  preAcceptTimeoutMs: 5_000,
  heartbeatIntervalMs: 10_000,
  metadataOnly: true
};

test('rejects missing or historical authorization before websocket creation', async () => {
  let calls = 0;
  await assert.rejects(
    observeTwelveR8kMetadata({ ...base, authorization: 'R8J_TEMPORAL_SEMANTICS_EXPLICITLY_AUTHORIZED', webSocketFactory: () => { calls += 1; } }),
    /R8K_METADATA_OBSERVATION_NOT_AUTHORIZED/
  );
  assert.equal(calls, 0);
});

test('collects aggregate metadata only and never returns raw payload, price, or timestamp', async () => {
  const h = harness();
  let nowValue = 1_000_000;
  const promise = observeTwelveR8kMetadata({
    ...base,
    webSocketFactory: () => h.socket,
    timers: h.timers,
    now: () => { nowValue += 1_000; return nowValue; }
  });

  h.listeners.get('open')();
  assert.deepEqual(h.sent[0], { action: 'subscribe', params: { symbols: 'EUR/USD' } });
  h.listeners.get('message')({ data: JSON.stringify({ event: 'subscribe-status', status: 'ok', success: [{ symbol: 'EUR/USD' }] }) });
  h.listeners.get('message')({ data: JSON.stringify({ event: 'price', symbol: 'EUR/USD', timestamp: 100, price: 1.111 }) });
  h.listeners.get('message')({ data: JSON.stringify({ event: 'price', symbol: 'EUR/USD', timestamp: 100, price: 1.112 }) });
  h.listeners.get('message')({ data: JSON.stringify({ event: 'price', symbol: 'EUR/USD', timestamp: 160, price: 1.113 }) });
  h.timeouts.at(-1)();

  const result = await promise;
  assert.equal(result.externalProviderCalls, 1);
  assert.equal(result.connections, 1);
  assert.equal(result.subscribeAttempts, 1);
  assert.equal(result.metadata.timestampDistinctCount, 2);
  assert.equal(result.metadata.repeatedTimestampCount, 1);
  assert.equal(result.metadata.timestampAdvanceCount, 1);
  assert.equal(result.metadata.minPositiveTimestampStepMs, 60_000);
  assert.equal(result.metadata.maxPositiveTimestampStepMs, 60_000);
  assert.equal(result.metadata.arrivalAdvanceCount, 2);
  assert.equal(result.metadata.rawPayloadRetained, false);
  assert.equal(result.metadata.rawPriceRetained, false);
  assert.equal(result.metadata.rawTimestampRetained, false);
  assert.equal('price' in result.metadata, false);
  assert.equal('timestamp' in result.metadata, false);
});

test('malformed timestamp is represented only as a finite-state flag', async () => {
  const h = harness();
  const promise = observeTwelveR8kMetadata({ ...base, webSocketFactory: () => h.socket, timers: h.timers });
  h.listeners.get('open')();
  h.listeners.get('message')({ data: JSON.stringify({ event: 'subscribe-status', status: 'ok', success: ['EUR/USD'] }) });
  h.listeners.get('message')({ data: JSON.stringify({ event: 'price', symbol: 'EUR/USD', timestamp: 'bad', price: 1.2 }) });
  h.timeouts.at(-1)();
  const result = await promise;
  assert.equal(result.metadata.timestampFieldPresent, true);
  assert.equal(result.metadata.timestampFinite, false);
  assert.equal(result.metadata.timestampDistinctCount, 0);
  assert.equal(result.metadata.rawTimestampRetained, false);
});

test('rejects widened observation bounds and non-metadata execution', async () => {
  await assert.rejects(observeTwelveR8kMetadata({ ...base, observationWindowMs: 60_001 }), /R8K_METADATA_BOUNDS_INVALID/);
  await assert.rejects(observeTwelveR8kMetadata({ ...base, metadataOnly: false }), /R8K_METADATA_ONLY_REQUIRED/);
});
