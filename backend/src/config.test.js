import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDashboardOrigin } from './config.js';

test('production requires a concrete dashboard origin rather than an open wildcard', () => {
  assert.throws(() => resolveDashboardOrigin({ NODE_ENV: 'production' }), /DASHBOARD_ORIGIN_REQUIRED_IN_PRODUCTION/);
  assert.throws(() => resolveDashboardOrigin({ NODE_ENV: 'production', DASHBOARD_ORIGIN: '*' }), /DASHBOARD_ORIGIN_REQUIRED_IN_PRODUCTION/);
  assert.throws(() => resolveDashboardOrigin({ NODE_ENV: 'production', DASHBOARD_ORIGIN: 'https://example.test/path' }), /DASHBOARD_ORIGIN_INVALID/);
});

test('normalizes a concrete HTTPS/HTTP origin and allows wildcard only outside production', () => {
  assert.equal(resolveDashboardOrigin({ NODE_ENV: 'production', DASHBOARD_ORIGIN: 'https://dashboard.example.test/' }), 'https://dashboard.example.test');
  assert.equal(resolveDashboardOrigin({ NODE_ENV: 'production', DASHBOARD_ORIGIN: 'http://127.0.0.1:3000' }), 'http://127.0.0.1:3000');
  assert.equal(resolveDashboardOrigin({ NODE_ENV: 'development' }), '*');
  assert.equal(resolveDashboardOrigin({ NODE_ENV: 'development', DASHBOARD_ORIGIN: '*' }), '*');
});

test('rejects dashboard origin URLs with credentials, query, fragment or unsupported schemes', () => {
  for (const origin of [
    'https://user:password@example.test',
    'https://example.test?secret=value',
    'https://example.test/#fragment',
    'file:///tmp/dashboard.html',
    'not-a-url'
  ]) {
    assert.throws(() => resolveDashboardOrigin({ NODE_ENV: 'production', DASHBOARD_ORIGIN: origin }), /DASHBOARD_ORIGIN_INVALID/);
  }
});
