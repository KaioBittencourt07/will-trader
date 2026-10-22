import assert from 'node:assert/strict';
import test from 'node:test';
import { isDeterministicFallbackEnabled } from './aiFallbackPolicy.js';

test('fallback is enabled by default for backward compatibility', () => {
  assert.equal(isDeterministicFallbackEnabled({}), true);
});

test('documented flag controls deterministic fallback', () => {
  assert.equal(isDeterministicFallbackEnabled({ ALLOW_DETERMINISTIC_FALLBACK: 'true' }), true);
  assert.equal(isDeterministicFallbackEnabled({ ALLOW_DETERMINISTIC_FALLBACK: 'false' }), false);
  assert.equal(isDeterministicFallbackEnabled({ ALLOW_DETERMINISTIC_FALLBACK: '0' }), false);
  assert.equal(isDeterministicFallbackEnabled({ ALLOW_DETERMINISTIC_FALLBACK: 'no' }), false);
});

test('legacy AI_FALLBACK_ENABLED flag takes precedence when explicitly configured', () => {
  assert.equal(isDeterministicFallbackEnabled({ AI_FALLBACK_ENABLED: 'false', ALLOW_DETERMINISTIC_FALLBACK: 'true' }), false);
  assert.equal(isDeterministicFallbackEnabled({ AI_FALLBACK_ENABLED: 'true', ALLOW_DETERMINISTIC_FALLBACK: 'false' }), true);
});

test('unrecognized explicit values fail closed instead of silently enabling fallback', () => {
  assert.equal(isDeterministicFallbackEnabled({ ALLOW_DETERMINISTIC_FALLBACK: 'enabled-ish' }), false);
});
