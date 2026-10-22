import { hasConfiguredValue } from './configuredValue.js';

function configuredToken(value) {
  const token = String(value ?? '').trim();
  if (!hasConfiguredValue(token) || Buffer.byteLength(token, 'utf8') < 32) return null;
  return token;
}

function isLoopback(hostname) {
  const host = String(hostname ?? '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

/**
 * Build credentials for the server-side market relay.
 * The general API token is only reused for loopback targets; it must never be
 * forwarded to a remote host. Remote relays require a dedicated secret.
 */
export function buildLocalRelayHeaders({ relayUrl, env = process.env } = {}) {
  let target;
  try {
    target = new URL(String(relayUrl ?? ''));
  } catch {
    return {};
  }

  if (!['http:', 'https:'].includes(target.protocol)) return {};

  const dedicatedToken = configuredToken(env.WILL_LOCAL_MARKET_RELAY_TOKEN);
  const token = dedicatedToken ?? (isLoopback(target.hostname)
    ? configuredToken(env.WILL_API_ACCESS_TOKEN)
    : null);

  return token ? { Authorization: `Bearer ${token}` } : {};
}
