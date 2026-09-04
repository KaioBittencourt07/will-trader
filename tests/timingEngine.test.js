import assert from 'node:assert/strict';
import test from 'node:test';
import { assessEntryTiming, TIMING_STATUS, TIMING_VERSION } from '../engine/src/timingEngine.js';

test('timing classifies extended/spiking candles without creating direction', () => {
  const result = assessEntryTiming({ snapshot: { valid: true, maDistanceAtr: 3, rangeExpansion: 2, exhaustion: 2 }, now: Date.parse('2026-09-02T12:00:00Z') });
  assert.equal(result.timingStatus, TIMING_STATUS.WAIT);
  assert.equal(result.timingVersion, TIMING_VERSION);
  assert.ok(result.timingReasons.includes('PRICE_EXTENDED'));
  assert.ok(!('direction' in result));
});

test('timing respects retest, stale evidence and expiry deterministically', () => {
  const ready = assessEntryTiming({ snapshot: { valid: true, breakout: true, pullbackRecovery: true }, now: 100 });
  const expired = assessEntryTiming({ snapshot: { valid: true }, validUntil: '1970-01-01T00:00:00.050Z', now: 100 });
  const invalid = assessEntryTiming({ snapshot: { valid: false }, now: 100 });
  assert.equal(ready.timingStatus, TIMING_STATUS.READY);
  assert.equal(expired.timingStatus, TIMING_STATUS.EXPIRED);
  assert.equal(invalid.timingStatus, TIMING_STATUS.INVALID);
});

test('timing distinguishes early, valid and expired entry windows semantically', () => {
  const early = assessEntryTiming({ snapshot: { valid: true }, validFrom: '1970-01-01T00:00:00.100Z', validUntil: '1970-01-01T00:00:00.200Z', now: 50 });
  const valid = assessEntryTiming({ snapshot: { valid: true }, validFrom: '1970-01-01T00:00:00.100Z', validUntil: '1970-01-01T00:00:00.200Z', now: 150 });
  const expired = assessEntryTiming({ snapshot: { valid: true }, validUntil: '1970-01-01T00:00:00.100Z', now: 150 });
  assert.deepEqual(early.timingReasons, ['TOO_EARLY']);
  assert.equal(valid.timingStatus, TIMING_STATUS.READY);
  assert.deepEqual(expired.timingReasons, ['LATE_ENTRY']);
});
