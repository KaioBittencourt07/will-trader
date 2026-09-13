import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateNoTrade } from '../engine/src/noTrade.js';

test('blocks stale or invalid data', () => {
  const result = evaluateNoTrade({ regime: 'TREND', setup: 'BREAKOUT', confidence: 90, dataValid: false });
  assert.equal(result.blocked, true);
  assert.ok(result.reasons.includes('STALE_DATA'));
});

test('blocks high macro risk', () => {
  const result = evaluateNoTrade({ regime: 'TREND', setup: 'BREAKOUT', confidence: 90, macroBlocked: true });
  assert.equal(result.blocked, true);
  assert.ok(result.reasons.includes('MACRO_RISK'));
});

test('blocks low confidence', () => {
  const result = evaluateNoTrade({ regime: 'TREND', setup: 'BREAKOUT', confidence: 69 });
  assert.equal(result.blocked, true);
  assert.ok(result.reasons.includes('LOW_CONFIDENCE'));
});

test('blocks unknown regime and setup', () => {
  const result = evaluateNoTrade({ confidence: 99 });
  assert.equal(result.blocked, true);
  assert.ok(result.reasons.includes('UNKNOWN_REGIME'));
  assert.ok(result.reasons.includes('UNKNOWN_SETUP'));
});
