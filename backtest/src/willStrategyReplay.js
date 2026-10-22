import { runWillPipeline } from '../../engine/src/pipeline.js';
import { deriveTechnical } from '../../data/src/providers/twelveDataProvider.js';
import { runHistoricalReplay } from './marketValidation.js';

const INTERVAL_MS = Object.freeze({
  '1min': 60_000,
  '5min': 5 * 60_000,
  '15min': 15 * 60_000,
  '30min': 30 * 60_000,
  '45min': 45 * 60_000,
  '1h': 60 * 60_000,
  '2h': 2 * 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '8h': 8 * 60 * 60_000
});
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const ASSET_PATTERN = /^[A-Z0-9][A-Z0-9._/-]{0,31}$/;

function parseTime(value) {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function positivePrice(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : NaN;
}

function normalizeAndValidateBars({ bars, asset, interval, asOfTimestamp }) {
  if (!Array.isArray(bars)) throw new TypeError('STRATEGY_BARS_MUST_BE_AN_ARRAY');
  const symbol = typeof asset === 'string' ? asset.trim().toUpperCase() : '';
  if (!ASSET_PATTERN.test(symbol)) throw new Error('STRATEGY_ASSET_INVALID');
  const timeframe = typeof interval === 'string' ? interval.trim().toLowerCase() : '';
  const barWidthMs = INTERVAL_MS[timeframe];
  if (!barWidthMs) throw new Error('STRATEGY_INTRADAY_INTERVAL_REQUIRED');
  const asOfMs = parseTime(asOfTimestamp);
  if (!Number.isFinite(asOfMs)) throw new Error('STRATEGY_AS_OF_TIMESTAMP_REQUIRED_WITH_TIMEZONE');
  if (bars.length < 12) throw new Error('STRATEGY_REPLAY_REQUIRES_AT_LEAST_12_COMPLETED_BARS');

  let previousOpenMs = -Infinity;
  const seen = new Set();
  const normalized = bars.map((bar, index) => {
    if (!bar || typeof bar !== 'object' || Array.isArray(bar)) throw new Error(`STRATEGY_BAR_INVALID:${index}`);
    const openMs = parseTime(bar.barOpenTimestamp);
    const closeMs = parseTime(bar.barCloseTimestamp);
    if (!Number.isFinite(openMs) || !Number.isFinite(closeMs)) throw new Error(`STRATEGY_BAR_TIMESTAMP_INVALID:${index}`);
    if (openMs <= previousOpenMs || seen.has(openMs)) throw new Error('STRATEGY_BARS_NOT_STRICTLY_CHRONOLOGICAL');
    previousOpenMs = openMs;
    seen.add(openMs);
    if (closeMs !== openMs + barWidthMs) throw new Error(`STRATEGY_BAR_DURATION_MISMATCH:${index}`);
    if (closeMs > asOfMs) throw new Error('STRATEGY_OPEN_OR_FUTURE_BAR_REJECTED');
    const open = positivePrice(bar.open);
    const high = positivePrice(bar.high);
    const low = positivePrice(bar.low);
    const close = positivePrice(bar.close);
    if (![open, high, low, close].every(Number.isFinite) ||
        high < Math.max(open, close, low) || low > Math.min(open, close, high)) {
      throw new Error(`STRATEGY_BAR_OHLC_INVALID:${index}`);
    }
    return {
      barOpenTimestamp: new Date(openMs).toISOString(),
      barCloseTimestamp: new Date(closeMs).toISOString(),
      timestampMs: closeMs,
      open,
      high,
      low,
      close
    };
  });
  return { symbol, timeframe, barWidthMs, asOfMs, bars: normalized };
}

/**
 * Runs the actual deterministic WILL pipeline against each completed OHLC
 * prefix, then evaluates its hypothetical scheduled signals against future
 * candle-opening prices. No network, AI advisor, files, history store, broker,
 * or live runtime is touched.
 *
 * A scheduled decision may have a future clickTime while executable-now is
 * false due to TOO_EARLY. For retrospective analysis only, releaseEligible
 * + valid timing is treated as a scheduled hypothetical entry. This does not
 * mean the signal was executable at its historical decision timestamp.
 */
export function runWillStrategyReplay({
  bars,
  asset,
  interval = '1min',
  asOfTimestamp,
  strategyOptions = {},
  replayOptions = {},
  datasetManifest = null
} = {}) {
  const prepared = normalizeAndValidateBars({ bars, asset, interval, asOfTimestamp });
  const {
    minimumConfidence = 70,
    entryWindowStartSeconds = 60,
    entryWindowEndSeconds = 300,
    entryDelaySeconds = 120,
    expirySeconds = replayOptions.expirySeconds ?? 60,
    windowBeforeMs = 2_000,
    windowAfterMs = 3_000,
    macroBlocked = false,
    newsBlocked = false
  } = strategyOptions;

  if (!Number.isFinite(Number(minimumConfidence)) || Number(minimumConfidence) < 0 || Number(minimumConfidence) > 100) {
    throw new Error('STRATEGY_MINIMUM_CONFIDENCE_INVALID');
  }
  if (!Number.isInteger(entryWindowStartSeconds) || entryWindowStartSeconds < 60 || entryWindowStartSeconds > 300 ||
      !Number.isInteger(entryWindowEndSeconds) || entryWindowEndSeconds < entryWindowStartSeconds || entryWindowEndSeconds > 300 ||
      !Number.isInteger(entryDelaySeconds) || entryDelaySeconds < entryWindowStartSeconds || entryDelaySeconds > entryWindowEndSeconds ||
      !Number.isInteger(expirySeconds) || expirySeconds <= 0 ||
      !Number.isFinite(windowBeforeMs) || windowBeforeMs < 0 ||
      !Number.isFinite(windowAfterMs) || windowAfterMs < 0) {
    throw new Error('STRATEGY_TIMING_OPTIONS_INVALID');
  }

  const priceObservations = prepared.bars.map((bar) => ({
    asset: prepared.symbol,
    timestamp: bar.barOpenTimestamp,
    price: bar.open,
    source: 'historical-OHLC-open',
    timeframe: prepared.timeframe,
    observationSemantics: 'CANDLE_OPEN_PRICE_AVAILABLE_AT_BAR_OPEN'
  }));

  const decisions = [];
  const decisionTrace = [];
  for (let index = 11; index < prepared.bars.length; index++) {
    const currentBar = prepared.bars[index];
    const candlePrefix = prepared.bars.slice(0, index + 1);
    // deriveTechnical expects the provider's newest-first payload and reverses
    // it internally before calculating features. Only completed bars through
    // currentBar are passed, so future OHLC cannot leak into this decision.
    const newestFirst = candlePrefix.slice().reverse().map((bar) => ({
      datetime: bar.barOpenTimestamp,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close
    }));
    const features = deriveTechnical(newestFirst);
    const market = {
      asset: prepared.symbol,
      timestamp: currentBar.barCloseTimestamp,
      timeframe: prepared.timeframe,
      price: currentBar.close,
      ...features,
      candleCount: candlePrefix.length,
      source: 'HISTORICAL_OHLC_REPLAY',
      valid: true,
      status: 'FRESH'
    };

    const result = runWillPipeline(market, {
      nowMs: currentBar.timestampMs,
      minimumConfidence,
      entryWindowStartSeconds,
      entryWindowEndSeconds,
      entryDelaySeconds,
      expirySeconds,
      windowBeforeMs,
      windowAfterMs,
      macroBlocked,
      newsBlocked
    });

    const id = `will-${prepared.symbol.replace(/[^A-Z0-9]/g, '-')}-${prepared.timeframe}-${currentBar.barCloseTimestamp.replace(/[^0-9]/g, '')}`;
    const scheduled = ['BUY', 'SELL'].includes(result.direction) &&
      result.blocked !== true &&
      result.releaseEligible === true &&
      result.timing?.valid === true &&
      Number.isFinite(parseTime(result.clickTime)) &&
      parseTime(result.clickTime) > currentBar.timestampMs;

    const replayDecision = {
      id,
      asset: prepared.symbol,
      timestamp: currentBar.barCloseTimestamp,
      decisionTimestamp: currentBar.barCloseTimestamp,
      direction: result.direction,
      blocked: result.direction === 'WAIT' ? false : !scheduled,
      executable: scheduled,
      plannedEntryTimestamp: scheduled ? result.clickTime : undefined,
      score: result.score,
      confidence: result.confidence,
      regime: result.regime,
      regimeVersion: result.regimeVersion,
      setup: result.setup,
      setupConfidence: result.setupConfidence,
      featureVersion: result.featureVersion,
      confirmations: result.confirmations,
      blockReasons: result.blockReasons ?? [],
      releaseEligible: result.releaseEligible === true,
      executableAtDecisionTime: result.executable === true,
      clickTime: result.clickTime ?? null,
      timingStatus: result.timingStatus ?? null,
      timing: result.timing ?? null,
      decisionCandleOpenTimestamp: currentBar.barOpenTimestamp,
      decisionCandleCloseTimestamp: currentBar.barCloseTimestamp,
      candlesUsed: candlePrefix.length
    };
    decisions.push(replayDecision);
    decisionTrace.push(replayDecision);
  }

  const report = runHistoricalReplay({
    decisions,
    observations: priceObservations,
    expirySeconds,
    entryDelayMs: 0,
    maxEntryQuoteDelayMs: replayOptions.maxEntryQuoteDelayMs ?? 5_000,
    maxExpiryQuoteDelayMs: replayOptions.maxExpiryQuoteDelayMs ?? 5_000,
    payoutRatio: replayOptions.payoutRatio ?? null,
    stake: replayOptions.stake ?? 1,
    costPerTrade: replayOptions.costPerTrade ?? 0,
    minimumBinaryTrades: replayOptions.minimumBinaryTrades ?? 100
  });

  const traceById = new Map(decisionTrace.map((item) => [item.id, item]));
  const detailedResults = report.results.map((trade) => ({
    ...trade,
    decision: traceById.get(trade.id) ?? null
  }));

  return Object.freeze({
    ...report,
    schemaVersion: 'will-strategy-historical-replay-v1',
    mode: 'WILL_STRATEGY_HISTORICAL_OHLC_REPLAY',
    asset: prepared.symbol,
    interval: prepared.timeframe,
    asOfTimestamp: new Date(prepared.asOfMs).toISOString(),
    barsAvailable: prepared.bars.length,
    decisionBars: decisions.length,
    strategy: {
      source: 'ACTUAL_WILL_PIPELINE',
      featureEngine: 'data/src/providers/twelveDataProvider.js:deriveTechnical',
      pipeline: 'engine/src/pipeline.js:runWillPipeline',
      minimumConfidence,
      entryWindowStartSeconds,
      entryWindowEndSeconds,
      entryDelaySeconds,
      expirySeconds,
      macroBlocked,
      newsBlocked,
      note: 'No historical macro/news feed supplied unless explicitly injected; output is not an execution record.'
    },
    datasetEvidence: datasetManifest
      ? { supplied: true, claim: 'CALLER_SUPPLIED_MANIFEST_NOT_VERIFIED_BY_STRATEGY_REPLAY', datasetManifest }
      : { supplied: false, claim: 'NO_DATASET_MANIFEST_ATTACHED' },
    timingIntegrity: {
      decisionUsesOnlyCompletedBars: true,
      futureBarsExcluded: true,
      candleOpenQuotesUsedForHypotheticalEntriesAndExpiry: true,
      scheduledClickDoesNotMeanExecutableAtDecisionTime: true,
      entryQuoteDelayMsMax: replayOptions.maxEntryQuoteDelayMs ?? 5_000,
      expiryQuoteDelayMsMax: replayOptions.maxExpiryQuoteDelayMs ?? 5_000
    },
    edgeProven: false,
    decisions: decisionTrace,
    results: detailedResults
  });
}
