export function buildCandleContext(candles = [], { maxCandles = 100 } = {}) {
  const valid = candles.map(c => ({
    timestamp: Date.parse(c?.timestamp ?? ''),
    open: Number(c?.open), high: Number(c?.high), low: Number(c?.low), close: Number(c?.close), volume: Number(c?.volume ?? 0)
  })).filter(c => Number.isFinite(c.timestamp) && c.timestamp > 0 && [c.open,c.high,c.low,c.close].every(Number.isFinite) && c.high >= Math.max(c.open,c.close,c.low) && c.low <= Math.min(c.open,c.close,c.high));
  const ordered = valid.sort((a,b) => a.timestamp-b.timestamp).slice(-maxCandles);
  if (!ordered.length) return { valid:false, reason:'NO_VALID_CANDLES', candles:[] };
  const closes = ordered.map(c => c.close);
  const first = closes[0];
  const last = closes.at(-1);
  const changePct = first ? ((last-first)/first)*100 : 0;
  const ranges = ordered.map(c => c.high-c.low);
  const avgRange = ranges.reduce((a,b)=>a+b,0)/ranges.length;
  return { valid:true, count:ordered.length, firstTimestamp:new Date(ordered[0].timestamp).toISOString(), lastTimestamp:new Date(ordered.at(-1).timestamp).toISOString(), lastClose:last, changePct, avgRange, candles:ordered.map(c=>({...c,timestamp:new Date(c.timestamp).toISOString()})) };
}
