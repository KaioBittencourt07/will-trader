import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveTechnical } from '../data/src/providers/twelveDataProvider.js';

function series(prices) {
  // Provider responses are newest-first; the feature builder restores
  // chronological order before calculating returns.
  return prices.map((close) => ({ close: String(close) })).reverse();
}

test('relative feature model recognizes a clean trend even when percentage moves are small', () => {
  const technical = deriveTechnical(series(Array.from({ length: 50 }, (_, index) => 1 + index * 0.001)));
  assert.equal(technical.technicalModel, 'relative-noise-v1');
  assert.ok(technical.trend > 0.15);
  assert.ok(technical.momentum > 0.15);
  assert.equal(technical.confirmations, 4);
});

test('relative volatility detects a recent turbulent regime independently of asset price scale', () => {
  const technical = deriveTechnical(series(Array.from({ length: 50 }, (_, index) => 100 + Math.sin(index * 1.7) * (index > 40 ? 4 : 0.3))));
  assert.ok(technical.volatility >= 0.85);
  assert.ok(technical.realizedVolatility > 0);
});

test('OHLC feature model identifies a strict breakout without inventing one from close-only data', () => {
  const candles = Array.from({ length: 20 }, (_, index) => {
    const close = 100 + index;
    return { open: String(close - 0.2), high: String(close + 0.4), low: String(close - 0.5), close: String(close) };
  });
  const technical = deriveTechnical([...candles].reverse());
  assert.equal(technical.patternModel, 'ohlc-v1');
  assert.equal(technical.breakout, true);
  assert.equal(technical.patternDirection, 1);
  assert.equal(deriveTechnical(series(Array.from({ length: 20 }, (_, index) => index + 1))).breakout, false);
});
