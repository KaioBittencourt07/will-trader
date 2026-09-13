export const DEFAULT_PAPER_MONITOR_REQUEST_TIMEOUT_MS = 55_000;
export const PAPER_MONITOR_TIMEOUT_SAFETY_MARGIN_MS = 1_000;

/** Resolves configuration without silently stretching a monitor cadence. */
export function resolvePaperMonitorRequestTimeout({ value, intervalMs } = {}) {
  const timeoutMs = value === undefined || value === null || value === ''
    ? DEFAULT_PAPER_MONITOR_REQUEST_TIMEOUT_MS
    : Number(value);
  const cadenceMs = Number(intervalMs);
  const maximumMs = cadenceMs - PAPER_MONITOR_TIMEOUT_SAFETY_MARGIN_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(cadenceMs) || maximumMs <= 0 || timeoutMs >= maximumMs) {
    return Object.freeze({ valid: false, status: 'MONITOR_TIMEOUT_CONFIG_INVALID', timeoutMs: null, maximumMs: Number.isFinite(maximumMs) ? maximumMs : null });
  }
  return Object.freeze({ valid: true, status: 'MONITOR_TIMEOUT_CONFIG_VALID', timeoutMs, maximumMs });
}

