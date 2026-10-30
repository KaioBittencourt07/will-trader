import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { observeTwelvePostSubscribe } from '../backend/src/twelvePostSubscribeObservation.js';

const MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const frame = (value, opcode = 1) => { const body = Buffer.from(value); return Buffer.concat([Buffer.from([0x80 | opcode, body.length]), body]); };
function decode(chunk) { const length = chunk[1] & 0x7f; const body = Buffer.from(chunk.subarray(6, 6 + length)); for (let i = 0; i < body.length; i += 1) body[i] ^= chunk[2 + (i % 4)]; return body.toString(); }
const status = JSON.stringify({ event: 'subscribe-status', status: 'ok', success: [{ symbol: 'EUR/USD' }] });
const quote = JSON.stringify({ event: 'price', symbol: 'EUR/USD', price: 9.876, timestamp: 123 });

async function scenario(mode) {
  let frames = 0; let subscribe; const sockets = new Set(); const server = http.createServer();
  server.on('upgrade', (request, socket) => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
    const accept = crypto.createHash('sha1').update(request.headers['sec-websocket-key'] + MAGIC).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.once('data', (chunk) => {
      frames += 1; subscribe = JSON.parse(decode(chunk));
      if (mode === 'immediate') socket.write(Buffer.concat([frame(status), frame(quote)]));
      if (mode === 'late') { socket.write(frame(status)); setTimeout(() => socket.write(frame(quote)), 60); }
      if (mode === 'delayed_status_quote') setTimeout(() => { socket.write(frame(status)); setTimeout(() => socket.write(frame(quote)), 80); }, 80);
      if (mode === 'silent') socket.write(frame(status));
      if (mode === 'close') { socket.write(Buffer.concat([frame(status), frame(Buffer.from([0x03, 0xf0]), 8)])); setImmediate(() => socket.end()); }
      if (mode === 'control') socket.write(Buffer.concat([frame(status), frame(JSON.stringify({ event: 'heartbeat' })), frame(quote)]));
      if (mode === 'multiple') socket.write(Buffer.concat([frame(status), frame(JSON.stringify({ event: 'heartbeat' })), frame('{bad'), frame(JSON.stringify({ event: 'mystery', token: 'SYNTHETIC_SECRET' })), frame(quote)]));
      if (mode === 'unknown_silent') socket.write(Buffer.concat([frame(status), frame(JSON.stringify({ event: 'mystery', token: 'SYNTHETIC_SECRET' }))]));
      if (mode === 'auth') socket.write(frame(JSON.stringify({ event: 'subscribe-status', status: 'error', message: 'api key forbidden' })));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `ws://127.0.0.1:${server.address().port}/socket`;
  const report = await observeTwelvePostSubscribe({ endpoint, apiKey: 'SYNTHETIC_SECRET', allowLocalSynthetic: true, observationWindowMs: 120, preAcceptTimeoutMs: 200 });
  for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve));
  return { report, frames, subscribe };
}

test('immediate and delayed quotes are observed inside the bounded window', async () => {
  for (const mode of ['immediate', 'late']) { const { report, frames, subscribe } = await scenario(mode);
    assert.equal(report.classification, 'QUOTE_OBSERVED_WITHIN_WINDOW'); assert.equal(report.firstQuoteObserved, true);
    assert.equal(report.quoteMessagesObserved, 1); assert.equal(frames, 1); assert.deepEqual(subscribe, { action: 'subscribe', params: { symbols: 'EUR/USD' } }); }
});

test('silence and close after accepted subscribe remain conservative', async () => {
  const silent = (await scenario('silent')).report; assert.equal(silent.classification, 'SUBSCRIBE_ACCEPTED_NO_QUOTE_WITHIN_WINDOW'); assert.equal(silent.causeConfirmed, false);
  const closed = (await scenario('close')).report; assert.equal(closed.classification, 'POST_SUBSCRIBE_ABNORMAL_CLOSE'); assert.equal(closed.causeConfirmed, false);
});

test('delay before acceptance does not consume the post-accept quote window', async () => {
  const { report } = await scenario('delayed_status_quote');
  assert.equal(report.classification, 'QUOTE_OBSERVED_WITHIN_WINDOW');
  assert.ok(report.elapsedMsToSubscribeStatus >= 50);
  assert.ok(report.elapsedMsToFirstQuote >= 50 && report.elapsedMsToFirstQuote < report.observationWindowMs);
});

test('pre-accept timeout is separate, bounded and fail-closed', async () => {
  const { report } = await scenario('never_status');
  assert.equal(report.classification, 'PRE_ACCEPT_TIMEOUT'); assert.equal(report.subscribeAccepted, false);
  assert.equal(report.firstQuoteObserved, false); assert.equal(report.causeConfirmed, false);
});

test('control and multiple unknown messages do not hide a later quote or infer auth', async () => {
  const control = (await scenario('control')).report; assert.equal(control.classification, 'QUOTE_OBSERVED_WITHIN_WINDOW'); assert.equal(control.nonPriceMessagesObserved, 2);
  const multiple = (await scenario('multiple')).report; assert.equal(multiple.classification, 'QUOTE_OBSERVED_WITHIN_WINDOW'); assert.equal(multiple.nonPriceMessagesObserved, 4);
  assert.equal(JSON.stringify(multiple).includes('SYNTHETIC_SECRET'), false); assert.equal(JSON.stringify(multiple).includes('9.876'), false);
  const unknownSilent = (await scenario('unknown_silent')).report;
  assert.equal(unknownSilent.classification, 'APPLICATION_PROTOCOL_INCONCLUSIVE'); assert.equal(unknownSilent.causeConfirmed, false);
});

test('only explicit protocol evidence classifies auth and budgets stay frozen', async () => {
  const report = (await scenario('auth')).report; assert.equal(report.classification, 'APPLICATION_AUTH_OR_ENTITLEMENT_REJECTED');
  assert.equal(report.connections, 1); assert.equal(report.subscribeAttempts, 1); assert.equal(report.applicationMessagesSent, 1);
  assert.equal(report.retries, 0); assert.equal(report.reconnects, 0); assert.equal(report.redirects, 0); assert.equal(report.restRequests, 0); assert.equal(report.saxoRequests, 0);
});

test('external target and observation windows above 60 seconds fail before access', async () => {
  await assert.rejects(() => observeTwelvePostSubscribe({ apiKey: 'SYNTHETIC_SECRET' }), /NOT_AUTHORIZED/);
  await assert.rejects(() => observeTwelvePostSubscribe({ endpoint: 'ws://127.0.0.1:1', apiKey: 'SYNTHETIC_SECRET', allowLocalSynthetic: true, observationWindowMs: 60_001 }), /WINDOW_INVALID/);
  await assert.rejects(() => observeTwelvePostSubscribe({ endpoint: 'ws://127.0.0.1:1', apiKey: 'SYNTHETIC_SECRET', allowLocalSynthetic: true, preAcceptTimeoutMs: 60_001 }), /PRE_ACCEPT_TIMEOUT_INVALID/);
});
