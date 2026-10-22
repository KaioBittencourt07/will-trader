import test from 'node:test';
import assert from 'node:assert/strict';

const values = new Map();
globalThis.window = {
  location: {
    href: 'https://dashboard.example.test/dashboard/',
    search: '?api=https%3A%2F%2Fapi.example.test'
  },
  WILL_API_BASE_URL: null
};
globalThis.localStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); }
};

const { getApiAccessToken, setApiAccessToken } = await import('../dashboard/api.js');

test('stores the API token with the currently configured API origin', () => {
  const token = 'will-test-api-token-long-enough-001';
  assert.equal(setApiAccessToken(token), true);
  assert.equal(values.get('willApiTokenOrigin'), 'https://api.example.test');
  assert.equal(getApiAccessToken(), token);
});

test('withholds the token when the API origin changes', () => {
  window.WILL_API_BASE_URL = 'https://attacker.example.test';
  assert.equal(getApiAccessToken(), '');

  window.WILL_API_BASE_URL = 'https://api.example.test';
  assert.equal(getApiAccessToken(), 'will-test-api-token-long-enough-001');
});

test('clearing the API token also clears its bound origin', () => {
  setApiAccessToken('');
  assert.equal(values.has('willApiToken'), false);
  assert.equal(values.has('willApiTokenOrigin'), false);
  assert.equal(getApiAccessToken(), '');
});
