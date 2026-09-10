export const TWELVE_HANDSHAKE_ANALYSIS_VERSION = 'twelve-websocket-handshake-analysis-v1';
export const TWELVE_WEBSOCKET_ENDPOINT = 'wss://ws.twelvedata.com/v1/quotes/price';

const status = (value) => value !== null && value !== undefined && value !== '' && Number.isInteger(Number(value)) ? Number(value) : null;

export function classifyPreOpenHandshakeFailure({ statusCode, redirected = false, timedOut = false,
  closeCode, errorCode } = {}) {
  const observedStatusCode = status(statusCode);
  let classification = 'HANDSHAKE_INCONCLUSIVE';
  let causeConfirmed = false;
  if (timedOut || errorCode === 'ETIMEDOUT') { classification = 'PRE_OPEN_TIMEOUT'; causeConfirmed = true; }
  else if (redirected || (observedStatusCode >= 300 && observedStatusCode < 400)) { classification = 'REDIRECT_REJECTED'; causeConfirmed = true; }
  else if (observedStatusCode !== null && observedStatusCode !== 101) { classification = 'UPGRADE_HTTP_REJECTED'; causeConfirmed = true; }
  else if (Number(closeCode) === 1006) classification = 'PRE_OPEN_ABNORMAL_CLOSE';
  return Object.freeze({ classification, causeConfirmed, observedStatusCode,
    authOrEntitlement: [401, 403].includes(observedStatusCode) ? 'POSSIBLE_NOT_CONFIRMED' : 'UNVERIFIED',
    providerCauseConfirmed: false, secretExposed: false });
}

export function inspectSyntheticUpgradeRequest({ url, headers = {} } = {}) {
  const parsed = new URL(url, 'ws://offline.invalid');
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
  const rawKey = normalized['sec-websocket-key'] || '';
  let keyBytes = 0;
  try { keyBytes = Buffer.from(rawKey, 'base64').length; } catch { keyBytes = 0; }
  const extensions = (normalized['sec-websocket-extensions'] || '').split(';')[0].split(',').map((value) => value.trim()).filter(Boolean);
  return Object.freeze({ analysisVersion: TWELVE_HANDSHAKE_ANALYSIS_VERSION, evidenceType: 'OFFLINE_SYNTHETIC_HANDSHAKE',
    requestTarget: parsed.pathname, apiKeyQueryPresent: parsed.searchParams.has('apikey'), apiKeyValueExposed: false,
    upgradeWebSocket: normalized.upgrade?.toLowerCase() === 'websocket', connectionUpgrade: /(^|,)\s*upgrade\s*(,|$)/i.test(normalized.connection || ''),
    secWebSocketVersion: normalized['sec-websocket-version'] || null, secWebSocketKeyPresent: Boolean(rawKey), secWebSocketKeyValidLength: keyBytes === 16,
    extensions, originPresent: Boolean(normalized.origin), userAgentPresent: Boolean(normalized['user-agent']),
    authorizationHeaderPresent: Boolean(normalized.authorization), rawHeadersExposed: false, secretExposed: false });
}
