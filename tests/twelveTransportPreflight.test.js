import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { runTwelveTransportPreflight } from '../backend/src/twelveTransportPreflight.js';

function connector(outcome) {
  return (options, callback) => {
    const socket = new EventEmitter();
    socket.authorized = outcome.authorized;
    socket.getProtocol = () => outcome.protocol ?? null;
    socket.setTimeout = () => {};
    socket.destroy = () => {};
    queueMicrotask(() => outcome.error ? socket.emit('error', Object.assign(new Error('secret must not escape'), { code: outcome.error })) : callback());
    return socket;
  };
}

test('healthy IPv4 transport is classified without WebSocket or authentication', async () => {
  const report = await runTwelveTransportPreflight({ lookup: async () => [{ address: 'redacted', family: 4 }],
    tcpConnect: connector({}), tlsConnect: connector({ authorized: true, protocol: 'TLSv1.3' }), env: {} });
  assert.equal(report.evidenceType, 'TRANSPORT_PREFLIGHT'); assert.equal(report.classification, 'TRANSPORT_BASIC_HEALTHY');
  assert.equal(report.ipv4.tcpReachable, true); assert.equal(report.ipv4.tlsAuthorized, true); assert.equal(report.tlsProtocol, 'TLSv1.3');
  assert.equal(report.authenticated, false); assert.equal(report.websocketOpened, false); assert.equal(report.subscribeSent, false);
  assert.equal(JSON.stringify(report).includes('redacted'), false); assert.equal(report.secretExposed, false);
});

test('DNS, TCP and TLS failures remain separate and sanitized', async () => {
  const dnsFailure = await runTwelveTransportPreflight({ lookup: async () => { const error = new Error('token=secret'); error.code = 'ENOTFOUND'; throw error; } });
  assert.equal(dnsFailure.classification, 'TRANSPORT_INCONCLUSIVE'); assert.equal(dnsFailure.dnsErrorCode, 'ENOTFOUND');
  const tcpFailure = await runTwelveTransportPreflight({ lookup: async () => [{ address: 'hidden', family: 4 }],
    tcpConnect: connector({ error: 'ECONNREFUSED' }), env: { HTTPS_PROXY: 'http://secret-proxy' } });
  assert.equal(tcpFailure.classification, 'TRANSPORT_FAILURE_IDENTIFIED'); assert.equal(tcpFailure.ipv4.reasonCode, 'ECONNREFUSED');
  assert.equal(tcpFailure.proxyDetected, true); assert.equal(JSON.stringify(tcpFailure).includes('secret-proxy'), false);
});

test('IPv4 and IPv6 are tested independently without addresses in output', async () => {
  let tcpCalls = 0; let tlsCalls = 0;
  const report = await runTwelveTransportPreflight({ lookup: async () => [{ address: 'v4-private', family: 4 }, { address: 'v6-private', family: 6 }],
    tcpConnect: (...args) => { tcpCalls += 1; return connector({})(...args); },
    tlsConnect: (...args) => { tlsCalls += 1; return connector({ authorized: true, protocol: 'TLSv1.3' })(...args); }, env: {} });
  assert.equal(report.resolvedFamily, 'IPV4_AND_IPV6'); assert.equal(tcpCalls, 2); assert.equal(tlsCalls, 2);
  assert.equal(JSON.stringify(report).includes('private'), false);
});
