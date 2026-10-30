export const ERROR_TAGS = Object.freeze({
  BAD_DATA: 'BAD_DATA',
  STALE_DATA: 'STALE_DATA',
  WRONG_REGIME: 'WRONG_REGIME',
  WEAK_SETUP: 'WEAK_SETUP',
  LOW_CONFLUENCE: 'LOW_CONFLUENCE',
  MACRO_EVENT: 'MACRO_EVENT',
  VOLATILITY: 'VOLATILITY',
  TIMING: 'TIMING',
  MODEL_ERROR: 'MODEL_ERROR',
  EXECUTION: 'EXECUTION',
  UNKNOWN: 'UNKNOWN'
});

export function registerError(record, errorTag, details = '') {
  return {
    decisionId: record?.id ?? null,
    asset: record?.asset ?? null,
    timestamp: record?.timestamp ?? null,
    errorTag: errorTag || ERROR_TAGS.UNKNOWN,
    details,
    createdAt: new Date().toISOString()
  };
}
