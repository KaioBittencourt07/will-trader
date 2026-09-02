import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveCandleFeatures, FEATURE_VERSION } from '../engine/src/featureEngine.js';

function newestFirst(candles) {
  return [...candles].reverse();
}

function trend(direction = 1) {
  return newestFirst(Array.from({ length: 20 }, (_, index) => {
    const close = 100 + direction * index;
    return { open: close - direction * .2, high: close + .4, low: close - .5, close };
  }));
}

test('creates a versioned, deterministic breakout feature snapshot from OHLC candles', () => {
  const features = deriveCandleFeatures(trend(1));
  assert.equal(features.featureVersion, FEATURE_VERSION);
  assert.equal(features.featureStatus, 'OK');
  assert.equal(features.breakout, true);
  assert.equal(features.breakoutDirection, 1);
  assert.ok(features.breakoutStrength > 0);
  assert.ok(features.atr > 0);
  assert.equal(features.swingStructure.higherHigh, true);
});

test('identifies objective rejection wicks and preserves symmetric sell-side breakout direction', () => {
  const rejection = Array.from({ length: 20 }, () => ({ open: 100, high: 101, low: 99, close: 100 }));
  rejection[19] = { open: 100.2, high: 101, low: 94, close: 100.8 };
  const wick = deriveCandleFeatures(newestFirst(rejection));
  const falling = deriveCandleFeatures(trend(-1));
  assert.equal(wick.rejection, true);
  assert.equal(wick.rejectionDirection, 1);
  assert.equal(falling.breakout, true);
  assert.equal(falling.breakoutDirection, -1);
});

test('rejects insufficient and zero-range OHLC evidence without fabricating features', () => {
  assert.equal(deriveCandleFeatures([{ open: 1, high: 1, low: 1, close: 1 }]).featureStatus, 'INSUFFICIENT_BARS');
  const flat = Array.from({ length: 14 }, () => ({ open: 1, high: 1, low: 1, close: 1 }));
  const result = deriveCandleFeatures(flat);
  assert.equal(result.featureStatus, 'INSUFFICIENT_BARS');
  assert.equal(result.missingReason, 'ZERO_RANGE_CANDLE');
});
