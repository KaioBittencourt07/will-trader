import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';

export const TWELVE_TRANSPORT_PREFLIGHT_VERSION = 'twelve-transport-preflight-v1';
const HOST = 'ws.twelvedata.com';
const PORT = 443;

const safeCode = (error) => /^[A-Z0-9_]{2,60}$/.test(String(error?.code || '')) ? String(error.code) : null;

function socketProbe(connect, options, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result, socket) => {
      if (settled) return;
      settled = true;
      socket?.destroy();
      resolve(result);
    };
    let socket;
    try {
      socket = connect(options, () => finish({ ok: true,
        authorized: typeof socket.authorized === 'boolean' ? socket.authorized : null,
        protocol: typeof socket.getProtocol === 'function' ? socket.getProtocol() : null }, socket));
      socket.setTimeout(timeoutMs, () => finish({ ok: false, code: 'TIMEOUT' }, socket));
      socket.once('error', (error) => finish({ ok: false, code: safeCode(error) }, socket));
    } catch (error) { finish({ ok: false, code: safeCode(error) }, socket); }
  });
}

export async function runTwelveTransportPreflight({
  lookup = (host) => dns.lookup(host, { all: true, verbatim: true }),
  tcpConnect = (options, callback) => net.connect(options, callback),
  tlsConnect = (options, callback) => tls.connect(options, callback),
  env = process.env,
  timeoutMs = 5_000
} = {}) {
  let records = [];
  let dnsErrorCode = null;
  try { records = await lookup(HOST); } catch (error) { dnsErrorCode = safeCode(error); }
  const families = [...new Set(records.map((entry) => Number(entry?.family)).filter((family) => family === 4 || family === 6))];
  const familyResults = {};
  for (const family of [4, 6]) {
    if (!families.includes(family)) {
      familyResults[`ipv${family}`] = { dnsResolved: false, tcpReachable: false, tlsHandshake: false, reasonCode: 'DNS_FAMILY_UNAVAILABLE' };
      continue;
    }
    const tcp = await socketProbe(tcpConnect, { host: HOST, port: PORT, family }, timeoutMs);
    const secure = tcp.ok ? await socketProbe(tlsConnect, { host: HOST, port: PORT, family, servername: HOST,
      rejectUnauthorized: true }, timeoutMs) : { ok: false, code: 'TCP_UNREACHABLE' };
    familyResults[`ipv${family}`] = { dnsResolved: true, tcpReachable: tcp.ok, tlsHandshake: secure.ok,
      tlsAuthorized: secure.authorized === true, tlsProtocol: secure.protocol ?? null,
      reasonCode: tcp.code ?? secure.code ?? null };
  }
  const successes = Object.values(familyResults).filter((result) => result.tlsHandshake && result.tlsAuthorized);
  const dnsResolved = families.length > 0;
  const classification = successes.length ? 'TRANSPORT_BASIC_HEALTHY' : dnsResolved ? 'TRANSPORT_FAILURE_IDENTIFIED' : 'TRANSPORT_INCONCLUSIVE';
  return Object.freeze({ preflightVersion: TWELVE_TRANSPORT_PREFLIGHT_VERSION, evidenceType: 'TRANSPORT_PREFLIGHT',
    target: { host: HOST, port: PORT, protocol: 'TLS_ONLY_NO_HTTP_NO_WEBSOCKET' },
    dnsResolved, resolvedFamily: families.length === 2 ? 'IPV4_AND_IPV6' : families[0] ? `IPV${families[0]}` : null,
    dnsErrorCode, tcpReachable: Object.values(familyResults).some((result) => result.tcpReachable),
    tlsHandshake: successes.length > 0, tlsAuthorized: successes.length > 0,
    tlsProtocol: successes.map((result) => result.tlsProtocol).filter(Boolean)[0] ?? null,
    proxyDetected: Boolean(env.HTTPS_PROXY || env.HTTP_PROXY || env.ALL_PROXY || env.https_proxy || env.http_proxy || env.all_proxy),
    ipv4: familyResults.ipv4, ipv6: familyResults.ipv6, classification,
    authenticated: false, websocketOpened: false, subscribeSent: false, apiKeyUsed: false,
    providerCommissioning: false, secretExposed: false });
}
