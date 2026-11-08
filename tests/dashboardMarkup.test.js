import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../dashboard/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../dashboard/app.js', import.meta.url), 'utf8');

test('dashboard loads the modular app and exposes per-asset chart controls', () => {
  assert.match(html, /<script type="module" src="\.\/app\.js"><\/script>/);
  for (const id of ['studyAsset', 'priceChart', 'studyStatus', 'studyPrice', 'studyTrend', 'studyMomentum', 'studyVolatility', 'studyConfirmations']) {
    assert.ok(html.includes('id="' + id + '"'), 'missing dashboard element: ' + id);
  }
});

test('dashboard exposes scanner performance telemetry without executing trades', () => {
  for (const id of ['scanLatency', 'marketLatency', 'apiCalls', 'cacheDedup', 'rateLimitEvents']) {
    assert.ok(html.includes('id="' + id + '"'), 'missing performance metric: ' + id);
  }
  assert.match(html, /Nenhuma ordem é enviada a corretoras/);
  assert.match(app, /function renderCandlestickChart/);
  assert.match(app, /function renderPerformance/);
  assert.match(app, /document\.createElementNS/);
});
