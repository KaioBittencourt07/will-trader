export const TIMING_STATUS = Object.freeze({ READY: 'READY', EXPIRED: 'EXPIRED', TOO_EARLY: 'TOO_EARLY', INVALID: 'INVALID' });

export function buildExecutionTiming({ signalTime, marketTime, executionDelayMs = 0, windowBeforeMs = 2_000, windowAfterMs = 3_000, entryWindowStartMs = null, entryWindowEndMs = null, expirySeconds = 60 } = {}) {
  const signalMs = Date.parse(signalTime);
  const marketMs = Date.parse(marketTime);
  if (!Number.isFinite(signalMs) || !Number.isFinite(marketMs) || signalMs < marketMs) return { status: TIMING_STATUS.INVALID, valid: false, reason: 'INVALID_TIMING' };
  const clickMs = signalMs + Math.max(0, executionDelayMs);
  const validFromMs = Number.isFinite(entryWindowStartMs) ? signalMs + Math.max(0, entryWindowStartMs) : clickMs - Math.max(0, windowBeforeMs);
  const validUntilMs = Number.isFinite(entryWindowEndMs) ? signalMs + Math.max(0, entryWindowEndMs) : clickMs + Math.max(0, windowAfterMs);
  if (validUntilMs < validFromMs || clickMs < validFromMs || clickMs > validUntilMs) return { status: TIMING_STATUS.INVALID, valid: false, reason: 'INVALID_ENTRY_WINDOW' };
  return { valid: true, status: TIMING_STATUS.TOO_EARLY, marketTime, signalTime, clickTime: new Date(clickMs).toISOString(), validFrom: new Date(validFromMs).toISOString(), validUntil: new Date(validUntilMs).toISOString(), expiryTime: new Date(clickMs + expirySeconds * 1000).toISOString() };
}

export function evaluateClickWindow(timing, now = Date.now()) {
  const from = Date.parse(timing?.validFrom);
  const until = Date.parse(timing?.validUntil);
  if (!Number.isFinite(from) || !Number.isFinite(until)) return { status: TIMING_STATUS.INVALID, canClick: false };
  if (now < from) return { status: TIMING_STATUS.TOO_EARLY, canClick: false, msToClick: Math.max(0, Date.parse(timing.clickTime) - now) };
  if (now > until) return { status: TIMING_STATUS.EXPIRED, canClick: false, msExpired: now - until };
  return { status: TIMING_STATUS.READY, canClick: true, msToClick: Math.max(0, Date.parse(timing.clickTime) - now), msRemaining: until - now };
}
