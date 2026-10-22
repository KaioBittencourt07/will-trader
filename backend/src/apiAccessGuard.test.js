import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiAccessGuard } from './apiAccessGuard.js';

function callGuard(guard, authorization) {
  let nextCalled = false;
  let statusCode = null;
  let body = null;
  const req = { headers: { authorization }, get(name) { return name.toLowerCase() === 'authorization' ? authorization : undefined; } };
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; }
  };
  guard(req, res, () => { nextCalled = true; });
  return { nextCalled, statusCode, body };
}

test('production refuses to start without a real API access token', () => {
  assert.throws(
    () => createApiAccessGuard({ env: { NODE_ENV: 'production' } }),
    /WILL_API_ACCESS_TOKEN_REQUIRED_IN_PRODUCTION/
  );
  assert.throws(
    () => createApiAccessGuard({ env: { NODE_ENV: 'production', WILL_API_ACCESS_TOKEN: 'configure_um_token_secreto_longo' } }),
    /WILL_API_ACCESS_TOKEN_REQUIRED_IN_PRODUCTION/
  );
});

test('development remains usable without an API token', () => {
  const guard = createApiAccessGuard({ env: { NODE_ENV: 'development' } });
  assert.deepEqual(callGuard(guard), { nextCalled: true, statusCode: null, body: null });
});

test('configured token protects the API with a Bearer header', () => {
  const guard = createApiAccessGuard({
    env: { NODE_ENV: 'production', WILL_API_ACCESS_TOKEN: 'a-long-test-token-001' }
  });

  assert.deepEqual(callGuard(guard), {
    nextCalled: false,
    statusCode: 401,
    body: { ok: false, error: 'API_ACCESS_TOKEN_REQUIRED' }
  });
  assert.equal(callGuard(guard, 'Basic a-long-test-token-001').statusCode, 401);
  assert.equal(callGuard(guard, 'Bearer wrong-token').statusCode, 401);
  assert.equal(callGuard(guard, 'Bearer a-long-test-token-001').nextCalled, true);
});

test('a configured token also protects local development when enabled', () => {
  const guard = createApiAccessGuard({
    env: { NODE_ENV: 'development', WILL_API_ACCESS_TOKEN: 'local-test-token-001' }
  });
  assert.equal(callGuard(guard).statusCode, 401);
  assert.equal(callGuard(guard, 'Bearer local-test-token-001').nextCalled, true);
});
