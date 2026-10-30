import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMultiTimeframeContext } from '../context/src/multiTimeframe.js';
import { buildConfidenceCalibration, buildLearningReadiness } from '../learning/src/calibration.js';

test('multi-timeframe context only marks aligned direction with independent views', () => {
  const context = buildMultiTimeframeContext([
    { asset: 'EUR/USD', timeframe: '1min', valid: true, trend: 0.6, momentum: 0.5, structure: 0.4 },
    { asset: 'EUR/USD', timeframe: '5min', valid: true, trend: 0.5, momentum: 0.4, structure: 0.6 }
  ]);
  assert.equal(context.direction, 'BUY');
  assert.equal(context.aligned, true);
});

test('calibration refuses to imply confidence from an insufficient sample', () => {
  const calibration = buildConfidenceCalibration([{ confidence: 74, outcome: 'WIN' }], { minimumSamples: 30 });
  assert.equal(calibration[0].observedWinRate, 1);
  assert.equal(calibration[0].calibrated, false);
});

test('learning readiness reports missing evidence without altering thresholds', () => {
  const readiness = buildLearningReadiness([{ outcome: 'WIN' }], { minimumSamples: 30 });
  assert.equal(readiness.calibrationReady, false);
  assert.equal(readiness.remainingSamples, 29);
  assert.equal(readiness.state, 'COLLECTING_EVIDENCE');
});
