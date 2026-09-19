import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMarketAdmission } from '../backend/src/marketAdmissionGate.js';

function baseSnapshot(overrides = {}) {
  return {
    asset: 'EUR/USD',
    timeframe: '1min',
    price: 1.1,
    timestamp: new Date().toISOString(),
    valid: true,
    status: 'OK',
    marketOpen: true,
    candleCount: 50,
    featureVersion: 'candle-price-action-v2',
    source: 'fixture',
    authoritativeFreshness: {
      timestampAuthority: 'PROVIDER_EVENT_TIME',
      authorityGate: 'PASS',
      freshnessGate: 'PASS'
    },
    ...overrides
  };
}

test('admits a complete snapshot with approved temporal freshness', () => {
  const result = evaluateMarketAdmission(baseSnapshot());
  assert.equal(result.admitted, true);
  assert.equal(result.state, 'ADMITTED');
  assert.equal(result.stage, 'DATA_ADMITTED');
  assert.deepEqual(result.reasons, []);
});

test('rejects a snapshot when timestamp authority is not approved', () => {
  const result = evaluateMarketAdmission(baseSnapshot({
    authoritativeFreshness: {
      timestampAuthority: 'UNRESOLVED',
      authorityGate: 'FAIL',
      freshnessGate: 'UNVERIFIED'
    }
  }));
  assert.equal(result.admitted, false);
  assert.ok(result.reasons.includes('TIMESTAMP_AUTHORITY_NOT_APPROVED'));
});

test('rejects market-closed and feature-incomplete observations before strategy study', () => {
  const result = evaluateMarketAdmission(baseSnapshot({
    marketOpen: false,
    candleCount: 12,
    featureVersion: null
  }));
  assert.equal(result.admitted, false);
  assert.ok(result.reasons.includes('MARKET_CLOSED'));
  assert.ok(result.reasons.includes('FEATURES_NOT_READY'));
});
