export const TIMING_VERSION = 'entry-timing-v2';
export const TIMING_STATUS = Object.freeze({ READY: 'READY', WAIT: 'WAIT_TIMING', EXPIRED: 'EXPIRED', INVALID: 'INVALID' });

const n = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value) => Math.max(0, Math.min(100, value));

/** Descriptive timing assessment; it never creates or reverses direction. */
export function assessEntryTiming({ snapshot = {}, signalTime = null, validFrom = null, validUntil = null, now = Date.now() } = {}) {
  const reasons = [];
  const current = typeof now === 'number' ? now : Date.parse(now);
  const until = Date.parse(validUntil ?? '');
  const from = Date.parse(validFrom ?? '');
  if (snapshot.valid === false || snapshot.status === 'STALE' || snapshot.featureStatus === 'INSUFFICIENT_BARS') return { timingStatus: TIMING_STATUS.INVALID, entryQuality: 0, timingReasons: ['TIMING_UNKNOWN'], timingVersion: TIMING_VERSION, validFrom, validUntil, windowRemainingMs: null };
  if (Number.isFinite(until) && current > until) return { timingStatus: TIMING_STATUS.EXPIRED, entryQuality: 0, timingReasons: ['LATE_ENTRY'], timingVersion: TIMING_VERSION, validFrom, validUntil, windowRemainingMs: 0 };
  if (Number.isFinite(from) && current < from) return { timingStatus: TIMING_STATUS.WAIT, entryQuality: 0, timingReasons: ['TOO_EARLY'], timingVersion: TIMING_VERSION, validFrom, validUntil, windowRemainingMs: Number.isFinite(until) ? until - current : null };
  if (n(snapshot.maDistanceAtr) !== null && Math.abs(n(snapshot.maDistanceAtr)) >= 2.5) reasons.push('PRICE_EXTENDED');
  if (n(snapshot.rangeExpansion) !== null && n(snapshot.rangeExpansion) >= 1.8) reasons.push('VOLATILITY_EXPANSION');
  if (n(snapshot.exhaustion) !== null && n(snapshot.exhaustion) >= 1.8) reasons.push('VOLATILITY_SPIKE');
  if (snapshot.breakout && !snapshot.pullbackRecovery) reasons.push('NO_RETEST');
  if (snapshot.reversal || snapshot.signalDeterioration) reasons.push('SIGNAL_DETERIORATION');
  const quality = clamp(100 - reasons.length * 22 - (n(snapshot.exhaustion) ?? 0) * 5);
  return { timingStatus: reasons.length ? TIMING_STATUS.WAIT : TIMING_STATUS.READY, entryQuality: quality, timingReasons: reasons.length ? reasons : ['TIMING_OK'], timingVersion: TIMING_VERSION, validFrom, validUntil, windowRemainingMs: Number.isFinite(until) ? Math.max(0, until - current) : null };
}
