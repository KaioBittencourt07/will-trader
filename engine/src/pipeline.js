import { willCore } from './willCore.js';
import { buildExecutionTiming } from './executionTiming.js';
import { assessEntryTiming } from './timingEngine.js';

export function analyzeMarket(data, context = {}) {
  return willCore(data, context);
}

function seconds(value, fallback, minimum, maximum) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

export function runWillPipeline(data, context = {}) {
  if (!data) throw new Error('Market snapshot ausente.');
  const result = willCore(data, context);
  const directional = result.direction !== 'WAIT' && !result.blocked;
  const signalTime = new Date().toISOString();
  const entryStartSeconds = seconds(context.entryWindowStartSeconds, process.env.ENTRY_WINDOW_START_SECONDS ?? 60, 60, 300);
  const entryEndSeconds = seconds(context.entryWindowEndSeconds, process.env.ENTRY_WINDOW_END_SECONDS ?? 300, entryStartSeconds, 300);
  const suggestedEntrySeconds = seconds(context.entryDelaySeconds, process.env.ENTRY_DELAY_SECONDS ?? 120, entryStartSeconds, entryEndSeconds);
  const timing = directional ? buildExecutionTiming({
    marketTime: data.timestamp,
    signalTime,
    executionDelayMs: suggestedEntrySeconds * 1_000,
    windowBeforeMs: Number(context.windowBeforeMs ?? process.env.EXECUTION_WINDOW_BEFORE_MS ?? 2_000),
    windowAfterMs: Number(context.windowAfterMs ?? process.env.EXECUTION_WINDOW_AFTER_MS ?? 3_000),
    entryWindowStartMs: entryStartSeconds * 1_000,
    entryWindowEndMs: entryEndSeconds * 1_000,
    expirySeconds: Number(context.expirySeconds ?? process.env.EXPIRY_SECONDS ?? 60)
  }) : null;
  const timingValid = Boolean(timing?.valid);
  const entryTiming = assessEntryTiming({ snapshot: data, signalTime, validFrom: timing?.validFrom ?? null, validUntil: timing?.validUntil ?? null });
  const onlyTooEarly = entryTiming.timingStatus === 'WAIT_TIMING'
    && Array.isArray(entryTiming.timingReasons)
    && entryTiming.timingReasons.length === 1
    && entryTiming.timingReasons[0] === 'TOO_EARLY';
  const timingHardBlocked = directional && (!timingValid || (entryTiming.timingStatus !== 'READY' && !onlyTooEarly));
  const releaseEligible = directional && timingValid && !timingHardBlocked;
  const canClickNow = releaseEligible && entryTiming.timingStatus === 'READY';
  return {
    ...result,
    releaseEligible,
    executable: canClickNow,
    canClickNow,
    clickTime: releaseEligible ? timing.clickTime : null,
    timing,
    ...entryTiming,
    blockReasons: timingHardBlocked ? [...(result.blockReasons ?? []), ...entryTiming.timingReasons] : result.blockReasons,
    generatedAt: signalTime
  };
}
