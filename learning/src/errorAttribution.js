export const ATTRIBUTION_VERSION = 'error-attribution-v1';
export const ERROR_CAUSES = Object.freeze({ DIRECTION_ERROR: 'DIRECTION_ERROR', TIMING_ERROR: 'TIMING_ERROR', LATE_ENTRY: 'LATE_ENTRY', VOLATILITY_SPIKE: 'VOLATILITY_SPIKE', FALSE_BREAKOUT: 'FALSE_BREAKOUT', REGIME_TRANSITION: 'REGIME_TRANSITION', DATA_ERROR: 'DATA_ERROR', PROVIDER_DIVERGENCE: 'PROVIDER_DIVERGENCE', UNKNOWN: 'UNKNOWN' });

/** Evidence-only attribution. A LOSS alone deliberately maps to UNKNOWN. */
export function attributeOutcome(record = {}) {
  const causes = [];
  const evidence = [];
  if (record.outcome === 'DATA_INVALID' || record.metadata?.dataQuality?.valid === false) { causes.push(ERROR_CAUSES.DATA_ERROR); evidence.push('PERSISTED_DATA_INVALID'); }
  const timingReasons = record.metadata?.timing?.reasons ?? [];
  if (timingReasons.includes('LATE_ENTRY')) { causes.push(ERROR_CAUSES.LATE_ENTRY); evidence.push('PERSISTED_LATE_ENTRY'); }
  if (timingReasons.includes('VOLATILITY_SPIKE')) { causes.push(ERROR_CAUSES.VOLATILITY_SPIKE); evidence.push('PERSISTED_VOLATILITY_SPIKE'); }
  if (timingReasons.includes('PRICE_EXTENDED') || timingReasons.includes('SIGNAL_DETERIORATION')) { causes.push(ERROR_CAUSES.TIMING_ERROR); evidence.push('PERSISTED_TIMING_DETERIORATION'); }
  if (record.metadata?.featureSnapshot?.breakout && record.outcome === 'LOSS') { causes.push(ERROR_CAUSES.FALSE_BREAKOUT); evidence.push('PERSISTED_BREAKOUT_AND_LOSS'); }
  if (!causes.length) causes.push(ERROR_CAUSES.UNKNOWN);
  return { attributionVersion: ATTRIBUTION_VERSION, primaryCause: causes[0], contributingCauses: causes.slice(1), evidence };
}
