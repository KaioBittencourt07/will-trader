export const FEATURE_VERSION = 'candle-price-action-v2';

const n = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Deterministic OHLC features. Input is newest-first as returned by Twelve Data. */
export function deriveCandleFeatures(values = []) {
  const candles = values.map((item) => ({ open: n(item.open), high: n(item.high), low: n(item.low), close: n(item.close) }))
    .filter((item) => Object.values(item).every((value) => value !== null)).reverse();
  const missing = (key) => ({ featureVersion: FEATURE_VERSION, featureStatus: 'INSUFFICIENT_BARS', missingReason: key });
  if (candles.length < 14) return missing('MIN_14_OHLC_BARS');
  const last = candles.at(-1);
  const prior = candles.slice(-11, -1);
  const range = last.high - last.low;
  if (!(range > 0)) return missing('ZERO_RANGE_CANDLE');
  const body = Math.abs(last.close - last.open);
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const trueRanges = candles.slice(1).map((item, index) => Math.max(item.high - item.low, Math.abs(item.high - candles[index].close), Math.abs(item.low - candles[index].close)));
  const atr = mean(trueRanges.slice(-13));
  const closes = candles.map((item) => item.close);
  const sma5 = mean(closes.slice(-5));
  const sma12 = mean(closes.slice(-12));
  const returns = closes.slice(1).map((close, index) => (close - closes[index]) / closes[index]);
  const recentRange = Math.max(...prior.map((item) => item.high)) - Math.min(...prior.map((item) => item.low));
  const support = Math.min(...prior.map((item) => item.low));
  const resistance = Math.max(...prior.map((item) => item.high));
  const breakoutDirection = last.close > resistance ? 1 : last.close < support ? -1 : 0;
  const closeLocation = (last.close - last.low) / range;
  const rejectionDirection = lowerWick / range >= .45 && closeLocation >= .65 ? 1 : upperWick / range >= .45 && closeLocation <= .35 ? -1 : 0;
  const slope = (last.close - closes.at(-6)) / Math.max(atr * 5, Number.EPSILON);
  const priorSlope = (closes.at(-2) - closes.at(-7)) / Math.max(atr * 5, Number.EPSILON);
  const trendDirection = Math.sign(last.close - sma12);
  const pullbackDepth = trendDirection === 0 ? 0 : Math.max(0, -trendDirection * (last.close - sma5) / Math.max(atr, Number.EPSILON));
  const compression = mean(trueRanges.slice(-5)) / Math.max(mean(trueRanges.slice(-13)), Number.EPSILON);
  const expansion = trueRanges.at(-1) / Math.max(mean(trueRanges.slice(-5)), Number.EPSILON);
  return {
    featureVersion: FEATURE_VERSION,
    featureStatus: 'OK',
    bodyRangeRatio: body / range,
    upperWickRatio: upperWick / range,
    lowerWickRatio: lowerWick / range,
    closeLocationValue: closeLocation,
    candleDirection: Math.sign(last.close - last.open),
    candleStrength: (last.close - last.open) / range,
    atr,
    trueRange: trueRanges.at(-1),
    atrNormalized: atr / Math.max(last.close, Number.EPSILON),
    maDistanceAtr: (last.close - sma12) / Math.max(atr, Number.EPSILON),
    trendSlopeAtr: slope,
    trendPersistence: returns.slice(-5).filter((value) => Math.sign(value) === Math.sign(slope)).length / 5,
    momentumRoc: (last.close - closes.at(-6)) / closes.at(-6),
    supportDistanceAtr: (last.close - support) / Math.max(atr, Number.EPSILON),
    resistanceDistanceAtr: (resistance - last.close) / Math.max(atr, Number.EPSILON),
    rangeCompression: clamp(compression, 0, 10),
    rangeExpansion: clamp(expansion, 0, 10),
    breakout: Boolean(breakoutDirection),
    breakoutDirection,
    breakoutStrength: breakoutDirection ? Math.abs(last.close - (breakoutDirection > 0 ? resistance : support)) / Math.max(atr, Number.EPSILON) : 0,
    rejection: Boolean(rejectionDirection),
    rejectionDirection,
    pullbackDepthAtr: pullbackDepth,
    pullbackRecovery: trendDirection !== 0 && Math.sign(last.close - last.open) === trendDirection,
    // A reversal is only a descriptive candle feature. The decision engine still
    // requires its own independent confirmations before a trade can be released.
    reversal: Math.sign(slope) !== 0 && Math.sign(priorSlope) !== 0 && Math.sign(slope) !== Math.sign(priorSlope) && Math.abs(slope) >= .25,
    exhaustion: clamp(Math.max(upperWick, lowerWick) / range * expansion, 0, 10),
    gap: null,
    // Keep the legacy numeric `structure` factor owned by deriveTechnical.
    // The price-action structure is a separate descriptive object.
    swingStructure: { higherHigh: last.high > prior.at(-1).high, higherLow: last.low > prior.at(-1).low, lowerHigh: last.high < prior.at(-1).high, lowerLow: last.low < prior.at(-1).low },
    normalizedRecentRange: recentRange / Math.max(atr, Number.EPSILON)
  };
}
