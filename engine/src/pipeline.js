import { willCore } from './willCore.js';
import { buildExecutionTiming } from './executionTiming.js';

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
  const executable = result.direction !== 'WAIT' && !result.blocked;
  const signalTime = new Date().toISOString();
  const entryStartSeconds = seconds(context.entryWindowStartSeconds, process.env.ENTRY_WINDOW_START_SECONDS ?? 60, 60, 300);
  const entryEndSeconds = seconds(context.entryWindowEndSeconds, process.env.ENTRY_WINDOW_END_SECONDS ?? 300, entryStartSeconds, 300);
  const suggestedEntrySeconds = seconds(context.entryDelaySeconds, process.env.ENTRY_DELAY_SECONDS ?? 120, entryStartSeconds, entryEndSeconds);
  const timing = executable ? buildExecutionTiming({
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
  return {
    ...result,
    executable: executable && timingValid,
    clickTime: executable && timingValid ? timing.clickTime : null,
    timing,
    generatedAt: signalTime
  };
}
