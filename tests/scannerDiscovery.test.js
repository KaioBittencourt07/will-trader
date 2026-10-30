import assert from 'node:assert/strict';
import test from 'node:test';
import { WAIT_CODES, adaptiveScanPriority, assessScannerCandidate, scannerTelemetry, setupReadiness, waitCode } from '../engine/src/scannerDiscovery.js';

test('scanner readiness is versioned descriptive evidence, never confidence', () => {
  const result = setupReadiness({ featureVersion: 'candle-price-action-v2', featureStatus: 'OK', breakout: true, trendSlopeAtr: .4, rangeCompression: .8 });
  assert.equal(result.setupForming, true);
  assert.equal(result.featureVersion, 'candle-price-action-v2');
  assert.equal('confidence' in result, false);
});

test('scanner preserves data, macro and strategy WAIT reason codes deterministically', () => {
  assert.equal(waitCode({ valid: false }, {}), WAIT_CODES.DATA);
  assert.equal(waitCode({}, {}, { macroBlocked: true }), WAIT_CODES.MACRO);
  assert.equal(waitCode({}, { direction: 'WAIT', blockReasons: ['UNKNOWN_SETUP'] }), WAIT_CODES.STRATEGY);
});

test('scanner marks a released future plan separately from click-now executable state', () => {
  const candidate = assessScannerCandidate({
    asset: 'BTC/USD',
    snapshot: { valid: true, marketOpen: true, featureStatus: 'OK', breakout: true, trendSlopeAtr: .3, rangeCompression: .8 },
    decision: { setup: 'BREAKOUT', direction: 'BUY', releaseEligible: true, executable: false, canClickNow: false, blocked: false }
  });
  assert.equal(candidate.stages.releaseEligible, true);
  assert.equal(candidate.stages.executable, false);
  assert.equal(candidate.waitCode, WAIT_CODES.TIMING);
});

test('scanner funnel exposes released and executable stages independently', () => {
  const candidate = assessScannerCandidate({ asset: 'EUR/USD', snapshot: { valid: true, marketOpen: true, featureStatus: 'OK', breakout: true, trendSlopeAtr: .3, rangeCompression: .8 }, decision: { setup: 'BREAKOUT', direction: 'BUY', releaseEligible: true, executable: true, canClickNow: true, blocked: false } });
  candidate.stages.ranked = true;
  const skipped = assessScannerCandidate({ asset: 'USD/JPY', snapshot: { valid: false }, decision: { setup: 'UNKNOWN', direction: 'WAIT', releaseEligible: false, executable: false, blocked: true } });
  const telemetry = scannerTelemetry([candidate, skipped], { providerRequests: 2, scannedAt: '2026-09-02T12:00:00.000Z' });
  assert.equal(telemetry.funnel.observed, 2);
  assert.equal(telemetry.funnel.releaseEligible, 1);
  assert.equal(telemetry.funnel.executable, 1);
  assert.equal(telemetry.funnel.ranked, 1);
  assert.equal(telemetry.waits.WAIT_DATA, 1);
  assert.equal(telemetry.requestsPerEligibleOpportunity, 2);
});

test('adaptive priority favors healthy forming setups and defers stale observations', () => {
  const healthy = adaptiveScanPriority({ valid: true, marketOpen: true, ageMs: 100, featureStatus: 'OK', breakout: true, trendSlopeAtr: .4, rangeCompression: .8 });
  const stale = adaptiveScanPriority({ valid: false, status: 'STALE' });
  assert.ok(healthy > stale);
  assert.equal(stale, 0);
});
