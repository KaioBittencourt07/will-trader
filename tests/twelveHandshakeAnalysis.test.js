import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { classifyPreOpenHandshakeFailure, inspectSyntheticUpgradeRequest } from '../data/src/providers/twelveHandshakeAnalysis.js';

test('native Node WebSocket emits the expected sanitized RFC6455 upgrade shape locally', {
  skip: typeof WebSocket !== 'function',
  timeout: 5_000
}, async () => {
  let captured;
  const server = http.createServer();
  server.on('upgrade', (request, socket) => {
    captured = inspectSyntheticUpgradeRequest({ url: request.url, headers: request.headers });
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const outcome = await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/quotes/price?apikey=SYNTHETIC_PLACEHOLDER`);
      const timer = setTimeout(() => finish(null), 2_000);
      socket.addEventListener('error', () => finish(classifyPreOpenHandshakeFailure({})), { once: true });
      socket.addEventListener('close', (event) => finish(classifyPreOpenHandshakeFailure({ closeCode: event.code })), { once: true });
    });
    assert.ok(captured, 'local server must observe the upgrade request');
    assert.ok(outcome, 'WebSocket client must emit a bounded error or close event');
    assert.deepEqual({ target: captured.requestTarget, query: captured.apiKeyQueryPresent, upgrade: captured.upgradeWebSocket,
      connection: captured.connectionUpgrade, version: captured.secWebSocketVersion, key: captured.secWebSocketKeyValidLength },
    { target: '/v1/quotes/price', query: true, upgrade: true, connection: true, version: '13', key: true });
    assert.equal(captured.authorizationHeaderPresent, false);
    assert.equal(captured.originPresent, false);
    assert.equal(JSON.stringify(captured).includes('SYNTHETIC_PLACEHOLDER'), false);
    assert.ok(['HANDSHAKE_INCONCLUSIVE', 'PRE_OPEN_ABNORMAL_CLOSE'].includes(outcome.classification));
    assert.equal(outcome.causeConfirmed, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('observable synthetic status, redirect and timeout are classified without inventing provider cause', () => {
  assert.deepEqual(classifyPreOpenHandshakeFailure({ statusCode: 403 }), {
    classification: 'UPGRADE_HTTP_REJECTED', causeConfirmed: true, observedStatusCode: 403,
    authOrEntitlement: 'POSSIBLE_NOT_CONFIRMED', providerCauseConfirmed: false, secretExposed: false });
  assert.equal(classifyPreOpenHandshakeFailure({ statusCode: 302 }).classification, 'REDIRECT_REJECTED');
  assert.equal(classifyPreOpenHandshakeFailure({ timedOut: true }).classification, 'PRE_OPEN_TIMEOUT');
  assert.equal(classifyPreOpenHandshakeFailure({ closeCode: 1006 }).authOrEntitlement, 'UNVERIFIED');
});
