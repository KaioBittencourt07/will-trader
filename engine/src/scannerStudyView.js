const finite = (value) => value !== null && value !== undefined && value !== ''
  && Number.isFinite(Number(value));

const iso = (value) => {
  const timestamp = Date.parse(value ?? '');
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
};

function candleView(bar = {}) {
  const timestamp = iso(bar.timestamp ?? bar.datetime ?? bar.time);
  const open = finite(bar.open) ? Number(bar.open) : null;
  const high = finite(bar.high) ? Number(bar.high) : null;
  const low = finite(bar.low) ? Number(bar.low) : null;
  const close = finite(bar.close) ? Number(bar.close) : null;
  if (!timestamp || ![open, high, low, close].every(Number.isFinite)) return null;
  if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) return null;
  return Object.freeze({ timestamp, open, high, low, close });
}

/**
 * Small, explicit dashboard projection. Raw provider payloads, auth metadata,
 * attestation internals and unbounded history are never sent to the UI.
 */
export function buildScannerStudyView({ asset, snapshot = {}, decision = {}, historyId = null } = {}) {
  const candles = (Array.isArray(snapshot.candles) ? snapshot.candles : [])
    .map(candleView)
    .filter(Boolean)
    .slice(-60);
  const direction = ['BUY', 'SELL', 'WAIT'].includes(decision.direction) ? decision.direction : 'WAIT';
  const blockReasons = Array.isArray(decision.blockReasons)
    ? decision.blockReasons.filter((reason) => typeof reason === 'string').slice(0, 12).map((reason) => reason.slice(0, 160))
    : [];
  const indicators = Object.freeze(Object.fromEntries(
    ['trend', 'momentum', 'structure', 'volatility', 'confirmations'].map((key) => [
      key, finite(snapshot[key]) ? Number(snapshot[key]) : null
    ])
  ));
  return Object.freeze({
    asset: String(asset ?? snapshot.asset ?? '').trim().toUpperCase() || null,
    timeframe: typeof snapshot.timeframe === 'string' ? snapshot.timeframe : null,
    price: finite(snapshot.price) && Number(snapshot.price) > 0 ? Number(snapshot.price) : null,
    timestamp: iso(snapshot.timestamp ?? snapshot.quoteTimestamp),
    status: typeof snapshot.status === 'string' ? snapshot.status : null,
    valid: snapshot.valid === true,
    source: typeof snapshot.source === 'string' ? snapshot.source : null,
    candles: Object.freeze(candles),
    indicators,
    decision: Object.freeze({
      direction,
      score: finite(decision.score) ? Number(decision.score) : null,
      confidence: finite(decision.confidence) ? Number(decision.confidence) : null,
      setup: typeof decision.setup === 'string' ? decision.setup : 'UNKNOWN',
      regime: typeof decision.regime === 'string' ? decision.regime : 'UNKNOWN',
      releaseEligible: decision.releaseEligible === true,
      executable: decision.executable === true,
      blocked: decision.blocked === true,
      blockReasons: Object.freeze(blockReasons)
    }),
    historyId: typeof historyId === 'string' ? historyId : null
  });
}
