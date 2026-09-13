import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { diagnoseTwelvePost101 } from '../backend/src/twelvePost101Diagnostic.js';

const MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const frame = (value, opcode = 1) => { const body = Buffer.from(value); return Buffer.concat([Buffer.from([0x80 | opcode, body.length]), body]); };
function decodeClientFrame(chunk) {
  const length = chunk[1] & 0x7f; const masked = Boolean(chunk[1] & 0x80); const offset = masked ? 6 : 2;
  const body = Buffer.from(chunk.subarray(offset, offset + length));
  if (masked) for (let index = 0; index < body.length; index += 1) body[index] ^= chunk[2 + (index % 4)];
  return body.toString();
}

async function scenario(mode) {
  let subscribePayload = null; let applicationFrames = 0; const sockets = new Set();
  const server = http.createServer();
  server.on('upgrade', (request, socket) => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
    const accept = crypto.createHash('sha1').update(request.headers['sec-websocket-key'] + MAGIC).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.once('data', (chunk) => {
      applicationFrames += 1; subscribePayload = JSON.parse(decodeClientFrame(chunk));
      if (mode === 'accepted_quote') socket.write(Buffer.concat([frame(JSON.stringify({ event: 'subscribe-status', status: 'ok', success: [{ symbol: 'EUR/USD' }] })), frame(JSON.stringify({ event: 'price', symbol: 'EUR/USD', price: 1.2, timestamp: 123 }))]));
      else if (mode === 'rejected') socket.write(frame(JSON.stringify({ event: 'subscribe-status', status: 'error', fails: [{ symbol: 'EUR/USD' }], message: 'symbol unavailable' })));
      else if (mode === 'auth') socket.write(frame(JSON.stringify({ event: 'subscribe-status', status: 'error', message: 'api key not authorized' })));
      else if (mode === 'unknown') socket.write(frame(JSON.stringify({ event: 'mystery', token: 'SYNTHETIC_SECRET' })));
      else if (mode === 'quote_first') socket.write(frame(JSON.stringify({ event: 'price', symbol: 'EUR/USD', price: 1.2, timestamp: 123 })));
      else if (mode === 'close') { socket.write(frame(Buffer.from([0x03, 0xf0]), 8)); setImmediate(() => socket.end()); }
      else if (mode === 'accepted_no_quote') socket.write(frame(JSON.stringify({ event: 'subscribe-status', status: 'ok', success: [{ symbol: 'EUR/USD' }] })));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `ws://127.0.0.1:${server.address().port}/v1/quotes/price`;
  const report = await diagnoseTwelvePost101({ endpoint, apiKey: 'SYNTHETIC_SECRET', allowLocalSynthetic: true, timeoutMs: 100 });
  for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve));
  return { report, subscribePayload, applicationFrames };
}

test('101, one exact subscribe, accepted status and first quote are observed in order', async () => {
  const { report, subscribePayload, applicationFrames } = await scenario('accepted_quote');
  assert.deepEqual(subscribePayload, { action: 'subscribe', params: { symbols: 'EUR/USD' } });
  assert.equal(applicationFrames, 1); assert.equal(report.handshakeStatus, 101); assert.equal(report.handshakeAccepted, true);
  assert.equal(report.subscribeAttempts, 1); assert.equal(report.subscribeAccepted, true); assert.equal(report.quoteObserved, true);
  assert.equal(report.quoteEventType, 'price'); assert.equal(report.quoteTimestampPresent, true);
  assert.equal(report.classification, 'HANDSHAKE_ACCEPTED_SUBSCRIBE_ACCEPTED_QUOTE_OBSERVED');
  assert.equal(JSON.stringify(report).includes('1.2'), false); assert.equal(JSON.stringify(report).includes('SYNTHETIC_SECRET'), false);
});

test('subscribe and explicit application auth rejections remain distinct', async () => {
  assert.equal((await scenario('rejected')).report.classification, 'SUBSCRIBE_REJECTED');
  assert.equal((await scenario('auth')).report.classification, 'APPLICATION_AUTH_OR_ENTITLEMENT_REJECTED');
});

test('unknown payload is fail-closed without exposing payload', async () => {
  const { report } = await scenario('unknown');
  assert.equal(report.classification, 'APPLICATION_PROTOCOL_UNRECOGNIZED');
  assert.equal(JSON.stringify(report).includes('SYNTHETIC_SECRET'), false);
  assert.equal((await scenario('quote_first')).report.classification, 'APPLICATION_PROTOCOL_UNRECOGNIZED');
});

test('no response, close before status, and accepted-without-quote are conservative', async () => {
  assert.equal((await scenario('none')).report.classification, 'POST_UPGRADE_TIMEOUT');
  const closed = (await scenario('close')).report;
  assert.equal(closed.classification, 'POST_UPGRADE_ABNORMAL_CLOSE'); assert.equal(closed.causeConfirmed, false);
  assert.equal((await scenario('accepted_no_quote')).report.classification, 'SUBSCRIBE_ACCEPTED_QUOTE_TIMEOUT');
});

test('external target is blocked without separate authorization', async () => {
  await assert.rejects(() => diagnoseTwelvePost101({ apiKey: 'SYNTHETIC_SECRET' }), /NOT_AUTHORIZED/);
});
