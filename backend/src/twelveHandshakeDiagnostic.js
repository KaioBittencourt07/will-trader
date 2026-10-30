import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

export const TWELVE_HANDSHAKE_DIAGNOSTIC_VERSION = 'twelve-handshake-diagnostic-v1';
const OFFICIAL_ENDPOINT = 'wss://ws.twelvedata.com/v1/quotes/price';
const MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function classifyStatus(statusCode) {
  if (statusCode === 101) return 'UPGRADE_ACCEPTED';
  if (statusCode >= 300 && statusCode < 400) return 'REDIRECT_REJECTED';
  if (statusCode === 401 || statusCode === 403) return 'AUTH_OR_ENTITLEMENT_REJECTED';
  if (statusCode === 429) return 'RATE_LIMITED';
  return 'UPGRADE_HTTP_REJECTED';
}

const safeCode = (error) => /^[A-Z0-9_]{2,60}$/.test(String(error?.code || '')) ? String(error.code) : null;

export async function diagnoseTwelveHandshake({ endpoint = OFFICIAL_ENDPOINT, apiKey,
  authorization, allowLocalSynthetic = false, timeoutMs = 5_000,
  httpRequest = http.request, httpsRequest = https.request } = {}) {
  const target = new URL(endpoint);
  const local = ['localhost', '127.0.0.1', '::1'].includes(target.hostname);
  const externalAuthorized = endpoint === OFFICIAL_ENDPOINT && authorization === 'R8A_HANDSHAKE_EXPLICITLY_AUTHORIZED';
  if (!(allowLocalSynthetic && local) && !externalAuthorized) throw new Error('HANDSHAKE_DIAGNOSTIC_NOT_AUTHORIZED');
  if (!apiKey) throw new Error('HANDSHAKE_DIAGNOSTIC_KEY_MISSING');
  if (!['ws:', 'wss:'].includes(target.protocol)) throw new Error('HANDSHAKE_DIAGNOSTIC_PROTOCOL_INVALID');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 5_000) throw new Error('HANDSHAKE_DIAGNOSTIC_TIMEOUT_INVALID');
  target.search = '';
  target.searchParams.set('apikey', apiKey);
  const requestUrl = new URL(target);
  requestUrl.protocol = target.protocol === 'wss:' ? 'https:' : 'http:';
  const websocketKey = crypto.randomBytes(16).toString('base64');
  const expectedAccept = crypto.createHash('sha1').update(websocketKey + MAGIC).digest('base64');
  const requestFn = target.protocol === 'wss:' ? httpsRequest : httpRequest;
  const base = { diagnosticVersion: TWELVE_HANDSHAKE_DIAGNOSTIC_VERSION, evidenceType: 'HANDSHAKE_DIAGNOSTIC',
    attempts: 1, requestTarget: '/v1/quotes/price', authenticatedQueryConfigured: true,
    followRedirects: false, retries: 0, subscribeSent: false, applicationBytesSent: 0,
    providerCommissioning: false, decisionImpact: 'NONE', prospectivePaperAuthorized: false, ordersExecuted: 0,
    secretExposed: false };
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result, socket) => {
      if (settled) return;
      settled = true;
      socket?.destroy();
      resolve(Object.freeze({ ...base, ...result }));
    };
    const request = requestFn(requestUrl, { method: 'GET', headers: { Connection: 'Upgrade', Upgrade: 'websocket',
      'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': websocketKey } });
    request.setTimeout(timeoutMs, () => finish({ result: 'BLOCKED', classification: 'PRE_OPEN_TIMEOUT',
      statusCode: null, causeConfirmed: true, errorCode: 'TIMEOUT' }, request));
    request.once('upgrade', (response, socket) => {
      const statusCode = Number(response.statusCode);
      const acceptValid = response.headers['sec-websocket-accept'] === expectedAccept;
      finish({ result: statusCode === 101 && acceptValid ? 'HANDSHAKE_OBSERVED' : 'BLOCKED',
        classification: statusCode === 101 && acceptValid ? 'UPGRADE_ACCEPTED' : 'INVALID_101_RESPONSE',
        statusCode, acceptHeaderPresent: Boolean(response.headers['sec-websocket-accept']), acceptValid,
        redirectLocationPresent: false, retryAfterPresent: false, causeConfirmed: true }, socket);
    });
    request.once('response', (response) => {
      const statusCode = Number(response.statusCode);
      response.resume();
      finish({ result: 'BLOCKED', classification: classifyStatus(statusCode), statusCode,
        acceptHeaderPresent: false, acceptValid: false,
        redirectLocationPresent: Boolean(response.headers.location), retryAfterPresent: Boolean(response.headers['retry-after']),
        causeConfirmed: true }, response.socket);
    });
    request.once('error', (error) => finish({ result: 'BLOCKED', classification: 'TRANSPORT_ERROR',
      statusCode: null, causeConfirmed: false, errorCode: safeCode(error) }, request));
    request.end();
  });
}
