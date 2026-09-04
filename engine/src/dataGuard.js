/** Produces an auditable WAIT whenever the market snapshot cannot support a trade decision. */
export function dataQualityWait(snapshot = {}) {
  const reason = snapshot.reason || snapshot.status || 'INVALID_MARKET_DATA';
  return {
    asset: snapshot.asset ?? null,
    timeframe: snapshot.timeframe ?? null,
    direction: 'WAIT',
    score: 0,
    confidence: 0,
    executable: false,
    blocked: true,
    clickTime: null,
    timing: null,
    regime: 'UNKNOWN',
    setup: 'UNKNOWN',
    confirmations: 0,
    reason: `Data Guard: ${reason}`,
    blockReasons: [`DATA_QUALITY_${reason}`]
  };
}
