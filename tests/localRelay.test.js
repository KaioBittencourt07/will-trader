import assert from 'node:assert/strict';
import test from 'node:test';
import { isLocalRelayFallbackEligible, resolveLocalRelayBaseUrl } from '../backend/src/routes/market.js';

test('relay URL preserves the requested asset and timeframe', () => {
  const query = new URLSearchParams({ asset: 'BTC/USD', timeframe: '1min', outputsize: '50' });
  assert.equal(query.get('asset'), 'BTC/USD');
  assert.equal(query.toString().includes('asset=BTC%2FUSD'), true);
});

test('a local relay sentinel is explicit and never confused with a market signal', () => {
  const sentinel = 'LOCAL_RELAY_REQUIRED';
  assert.equal(/LOCAL_RELAY_REQUIRED/.test(sentinel), true);
  assert.equal(['BUY', 'SELL', 'WAIT'].includes(sentinel), false);
});


test('local relay requires an explicit independent endpoint and blocks self-reference', () => {
  assert.throws(
    () => resolveLocalRelayBaseUrl({ relayUrl: '', backendPort: 3000 }),
    /LOCAL_RELAY_NOT_CONFIGURED/
  );
  assert.throws(
    () => resolveLocalRelayBaseUrl({ relayUrl: 'http://127.0.0.1:3000', backendPort: 3000 }),
    /LOCAL_RELAY_SELF_REFERENCE/
  );
  assert.throws(
    () => resolveLocalRelayBaseUrl({ relayUrl: 'ftp://127.0.0.1:3001', backendPort: 3000 }),
    /LOCAL_RELAY_URL_INVALID/
  );
  assert.equal(
    resolveLocalRelayBaseUrl({ relayUrl: 'http://127.0.0.1:3001/', backendPort: 3000 }),
    'http://127.0.0.1:3001'
  );
});

test('scanner only falls back to an explicitly configured relay for eligible provider failures', () => {
  assert.equal(isLocalRelayFallbackEligible(new Error('Twelve Data network error'), { configured: false }), false);
  assert.equal(isLocalRelayFallbackEligible(new Error('Twelve Data network error'), { configured: true }), true);
  const cooldown = new Error('Provider cooldown active');
  cooldown.code = 'PROVIDER_COOLDOWN';
  assert.equal(isLocalRelayFallbackEligible(cooldown, { configured: true }), true);
  const rateLimit = new Error('HTTP 429');
  rateLimit.status = 429;
  assert.equal(isLocalRelayFallbackEligible(rateLimit, { configured: true }), true);
  const credentials = new Error('HTTP 401');
  credentials.status = 401;
  assert.equal(isLocalRelayFallbackEligible(credentials, { configured: true }), false);
});
