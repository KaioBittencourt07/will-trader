const BLOCK_REASONS = Object.freeze({
  UNKNOWN_REGIME: 'UNKNOWN_REGIME',
  UNKNOWN_SETUP: 'UNKNOWN_SETUP',
  HIGH_VOLATILITY: 'HIGH_VOLATILITY',
  LOW_CONFIDENCE: 'LOW_CONFIDENCE',
  MACRO_RISK: 'MACRO_RISK',
  STALE_DATA: 'STALE_DATA'
});

export function evaluateNoTrade({ regime = 'UNKNOWN', setup = 'UNKNOWN', volatility = 0, confidence = 0, macroBlocked = false, dataValid = true, minimumConfidence = 70 }) {
  const reasons = [];
  if (!dataValid) reasons.push(BLOCK_REASONS.STALE_DATA);
  if (regime === 'UNKNOWN') reasons.push(BLOCK_REASONS.UNKNOWN_REGIME);
  if (setup === 'UNKNOWN') reasons.push(BLOCK_REASONS.UNKNOWN_SETUP);
  if (Number(volatility) >= 0.85) reasons.push(BLOCK_REASONS.HIGH_VOLATILITY);
  if (Number(confidence) < Number(minimumConfidence)) reasons.push(BLOCK_REASONS.LOW_CONFIDENCE);
  if (macroBlocked) reasons.push(BLOCK_REASONS.MACRO_RISK);
  return { blocked: reasons.length > 0, reasons };
}
