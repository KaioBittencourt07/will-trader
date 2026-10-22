import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLocalRelayHeaders } from './localRelayAuth.js';

const apiToken = 'will-api-token-test-value-with-more-than-32-bytes';
const relayToken = 'will-dedicated-relay-token-with-more-than-32-bytes';

test('reuses the API token only for a loopback relay target', () => {
  assert.deepEqual(
    buildLocalRelayHeaders({
      relayUrl: 'http://127.0.0.1:3000',
      env: { WILL_API_ACCESS_TOKEN: apiToken }
    }),
    { Authorization: `Bearer ${apiToken}` }
  );
  assert.deepEqual(
    buildLocalRelayHeaders({
      relayUrl: 'http://localhost:3000',
      env: { WILL_API_ACCESS_TOKEN: apiToken }
    }),
    { Authorization: `Bearer ${apiToken}` }
  );
});

test('never forwards the API token to a remote relay host', () => {
  assert.deepEqual(
    buildLocalRelayHeaders({
      relayUrl: 'https://relay.example.test',
      env: { WILL_API_ACCESS_TOKEN: apiToken }
    }),
    {}
  );
});

test('uses a dedicated relay token for an explicitly configured remote relay', () => {
  assert.deepEqual(
    buildLocalRelayHeaders({
      relayUrl: 'https://relay.example.test',
      env: {
        WILL_API_ACCESS_TOKEN: apiToken,
        WILL_LOCAL_MARKET_RELAY_TOKEN: relayToken
      }
    }),
    { Authorization: `Bearer ${relayToken}` }
  );
});

test('ignores placeholders, too-short tokens and unsupported URL schemes', () => {
  assert.deepEqual(
    buildLocalRelayHeaders({
      relayUrl: 'http://127.0.0.1:3000',
      env: { WILL_API_ACCESS_TOKEN: 'configure_um_token_secreto_longo' }
    }),
    {}
  );
  assert.deepEqual(
    buildLocalRelayHeaders({
      relayUrl: 'http://127.0.0.1:3000',
      env: { WILL_API_ACCESS_TOKEN: 'short' }
    }),
    {}
  );
  assert.deepEqual(
    buildLocalRelayHeaders({
      relayUrl: 'file:///etc/passwd',
      env: { WILL_LOCAL_MARKET_RELAY_TOKEN: relayToken }
    }),
    {}
  );
});
