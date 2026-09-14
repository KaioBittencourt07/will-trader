import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveScannerRoundState } from '../backend/src/scannerRoundState.js';

test('no admitted study is never mislabeled as strategic WAIT', () => {
  const state = deriveScannerRoundState({
    analyses: [],
    unavailable: [{ asset: 'EUR/USD', error: 'MARKET_ADMISSION_REJECTED' }]
  });
  assert.equal(state.state, 'NO_ADMITTED_MARKET_STUDY');
  assert.equal(state.strategicWait, false);
  assert.match(state.reason, /Admission Gate/);
});

test('WAIT is strategic only after at least one admitted study reaches the decision layer', () => {
  const state = deriveScannerRoundState({
    analyses: [{ asset: 'EUR/USD', decision: { direction: 'WAIT' } }],
    unavailable: []
  });
  assert.equal(state.state, 'STRATEGIC_WAIT');
  assert.equal(state.strategicWait, true);
  assert.equal(state.admittedStudies, 1);
});

test('directional admitted study without released recommendation is not called WAIT', () => {
  const state = deriveScannerRoundState({
    analyses: [{ asset: 'EUR/USD', decision: { direction: 'BUY' } }],
    unavailable: []
  });
  assert.equal(state.state, 'ADMITTED_NO_RELEASED_CANDIDATE');
  assert.equal(state.strategicWait, false);
});

test('released recommendation has candidate state', () => {
  const state = deriveScannerRoundState({
    analyses: [{ asset: 'EUR/USD', decision: { direction: 'BUY' } }],
    recommendation: { asset: 'EUR/USD' }
  });
  assert.equal(state.state, 'CANDIDATE_AVAILABLE');
  assert.equal(state.strategicWait, false);
});
