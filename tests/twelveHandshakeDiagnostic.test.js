import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { diagnoseTwelveHandshake } from '../backend/src/twelveHandshakeDiagnostic.js';

const MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

async function localServer(handler) {
  const server = http.createServer();
  const sockets = new Set();
  server.on('upgrade', (request, socket, head) => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket)); handler(request, socket, head);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  server.testSockets = sockets;
  return { server, endpoint: `ws://127.0.0.1:${server.address().port}/v1/quotes/price` };
}

async function close(server) {
  for (const socket of server.testSockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
}

test('isolated diagnostic observes a valid local 101 and sends no application data', async () => {
  let requestUrl; let applicationBytes = 0;
  const { server, endpoint } = await localServer((request, socket) => {
    requestUrl = request.url;
    socket.on('data', (chunk) => { applicationBytes += chunk.length; });
    const accept = crypto.createHash('sha1').update(request.headers['sec-websocket-key'] + MAGIC).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  });
  const report = await diagnoseTwelveHandshake({ endpoint, apiKey: 'SYNTHETIC_SECRET', allowLocalSynthetic: true });
  await close(server);
  assert.equal(report.result, 'HANDSHAKE_OBSERVED'); assert.equal(report.statusCode, 101); assert.equal(report.acceptValid, true);
  assert.equal(report.subscribeSent, false); assert.equal(report.applicationBytesSent, 0); assert.equal(applicationBytes, 0);
  assert.match(requestUrl, /apikey=SYNTHETIC_SECRET/); assert.equal(JSON.stringify(report).includes('SYNTHETIC_SECRET'), false);
});

test('302, 401, 403 and 429 are observed exactly and sanitized', async (t) => {
  for (const [statusCode, classification] of [[302, 'REDIRECT_REJECTED'], [401, 'AUTH_OR_ENTITLEMENT_REJECTED'],
    [403, 'AUTH_OR_ENTITLEMENT_REJECTED'], [429, 'RATE_LIMITED']]) {
    await t.test(String(statusCode), async () => {
      const { server, endpoint } = await localServer((_request, socket) => socket.end(`HTTP/1.1 ${statusCode} Synthetic\r\nLocation: ws://secret.invalid\r\nRetry-After: 99\r\nConnection: close\r\n\r\n`));
      const report = await diagnoseTwelveHandshake({ endpoint, apiKey: 'SYNTHETIC_SECRET', allowLocalSynthetic: true });
      await close(server);
      assert.equal(report.statusCode, statusCode); assert.equal(report.classification, classification); assert.equal(report.result, 'BLOCKED');
      assert.equal(report.retries, 0); assert.equal(report.followRedirects, false); assert.equal(report.subscribeSent, false);
      assert.equal(JSON.stringify(report).includes('SYNTHETIC_SECRET'), false);
    });
  }
});

test('timeout is bounded, fail-closed and no external target is allowed by default', async () => {
  const { server, endpoint } = await localServer(() => {});
  const report = await diagnoseTwelveHandshake({ endpoint, apiKey: 'SYNTHETIC_SECRET', allowLocalSynthetic: true, timeoutMs: 100 });
  await close(server);
  assert.equal(report.classification, 'PRE_OPEN_TIMEOUT'); assert.equal(report.statusCode, null); assert.equal(report.retries, 0);
  await assert.rejects(() => diagnoseTwelveHandshake({ endpoint: 'wss://example.com/x', apiKey: 'x' }), /NOT_AUTHORIZED/);
});

test('invalid 101 accept proof fails closed', async () => {
  const { server, endpoint } = await localServer((_request, socket) => socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: invalid\r\n\r\n'));
  const report = await diagnoseTwelveHandshake({ endpoint, apiKey: 'SYNTHETIC_SECRET', allowLocalSynthetic: true });
  await close(server);
  assert.equal(report.classification, 'INVALID_101_RESPONSE'); assert.equal(report.result, 'BLOCKED'); assert.equal(report.acceptValid, false);
});
