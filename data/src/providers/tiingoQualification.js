import { normalizeMarketSnapshot } from '../marketAdapter.js';

export const TIINGO_OFFLINE_ADAPTER_VERSION = 'tiingo-fx-offline-adapter-v1';
export const TIINGO_QUALIFICATION = Object.freeze({
  provider: 'tiingo-fx',
  status: 'QUALIFIED_OFFLINE_WITH_LIMITATIONS',
  canonicalSymbol: 'EUR/USD',
  providerTicker: 'EURUSD',
  willTimeframe: '1min',
  resampleFreq: '1min',
  resampleFreqSupport: 'UNVERIFIED_IN_OFFICIAL_DOCUMENTATION',
  candleCompleteness: 'UNVERIFIED_BY_PROVIDER_PAYLOAD',
  verifiedClosedEligibility: false,
  enabledByDefault: false
});

const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

// This is a conservative local policy for integrating provider failures with
// multi-provider-ohlc-resilience-v1. Tiingo's public docs do not promise an
// exhaustive HTTP status taxonomy, so unknown failures remain unavailable.
export function classifyTiingoFailure(error) {
  const status = Number(error?.status);
  if (status === 401 || status === 403) return 'MISCONFIGURED';
  if (status === 429) return 'RATE_LIMITED';
  return 'UNAVAILABLE';
}

export function transformTiingoFxOffline({
  topResponse,
  historicalResponse,
  canonicalSymbol = 'EUR/USD',
  providerTicker = 'EURUSD',
  timeframe = '1min',
  resampleFreq = '1min',
  receivedAt,
  maxAgeMs = 30_000
} = {}) {
  if (canonicalSymbol !== TIINGO_QUALIFICATION.canonicalSymbol || providerTicker !== TIINGO_QUALIFICATION.providerTicker) {
    fail('TIINGO_SYMBOL_MAPPING_MISMATCH');
  }
  if (timeframe !== '1min' || resampleFreq !== '1min') fail('TIINGO_TIMEFRAME_MAPPING_MISMATCH');
  if (maxAgeMs !== 30_000) fail('TIINGO_FRESHNESS_GATE_FROZEN');

  const receivedAtMs = Date.parse(receivedAt ?? '');
  if (!Number.isFinite(receivedAtMs)) fail('TIINGO_PROVIDER_RECEIVED_AT_MISSING');

  const top = Array.isArray(topResponse) ? topResponse.find((entry) => entry?.ticker === providerTicker) : topResponse;
  if (top?.ticker !== providerTicker) fail('TIINGO_RESPONSE_SYMBOL_MISMATCH');
  const quoteTimestamp = top?.quoteTimestamp;
  if (!Number.isFinite(Date.parse(quoteTimestamp ?? ''))) fail('TIINGO_QUOTE_TIMESTAMP_MISSING');
  const bid = numeric(top?.bidPrice);
  const ask = numeric(top?.askPrice);
  const mid = numeric(top?.midPrice);
  if ([bid, ask, mid].some((value) => value === null || value <= 0) || bid > ask) fail('TIINGO_QUOTE_MALFORMED');
  if (Math.abs(mid - ((bid + ask) / 2)) > 1e-10) fail('TIINGO_MIDPRICE_INCONSISTENT');

  if (!Array.isArray(historicalResponse) || !historicalResponse.length) fail('TIINGO_OHLC_MISSING');
  const candles = historicalResponse.map((candle) => {
    if (candle?.ticker !== undefined && candle.ticker !== providerTicker) fail('TIINGO_RESPONSE_SYMBOL_MISMATCH');
    const mapped = {
      datetime: candle?.date,
      open: numeric(candle?.open),
      high: numeric(candle?.high),
      low: numeric(candle?.low),
      close: numeric(candle?.close)
    };
    if (!Number.isFinite(Date.parse(mapped.datetime ?? '')) ||
        [mapped.open, mapped.high, mapped.low, mapped.close].some((value) => value === null) ||
        mapped.low > mapped.high || mapped.open < mapped.low || mapped.open > mapped.high ||
        mapped.close < mapped.low || mapped.close > mapped.high) fail('TIINGO_OHLC_MALFORMED');
    return mapped;
  }).sort((left, right) => Date.parse(right.datetime) - Date.parse(left.datetime));

  const latest = candles[0];
  const quoteAgeMs = receivedAtMs - Date.parse(quoteTimestamp);
  const base = normalizeMarketSnapshot({
    asset: providerTicker,
    timeframe,
    price: mid,
    timestamp: quoteTimestamp,
    quoteTimestamp,
    candleTimestamp: latest.datetime,
    latestCandleTimestamp: latest.datetime,
    latestClosedCandleTimestamp: null,
    candles,
    source: 'tiingo-fx',
    providerReceivedAt: new Date(receivedAtMs).toISOString(),
    candleCompleteness: 'UNVERIFIED_BY_PROVIDER_PAYLOAD',
    verifiedClosedEligibility: false,
    resampleFreq,
    resampleFreqSupport: 'UNVERIFIED_IN_OFFICIAL_DOCUMENTATION',
    freshnessBasis: 'REST_QUOTE_TIMESTAMP',
    freshnessPolicyVersion: 'rest-quote-freshness-v1',
    freshnessMaxAgeMs: 30_000,
    quoteAgeMs,
    candleAgeMs: receivedAtMs - Date.parse(latest.datetime),
    qualificationVersion: 'tiingo-fx-offline-qualification-v1',
    adapterVersion: TIINGO_OFFLINE_ADAPTER_VERSION,
    timestampOrigins: {
      quoteTimestamp: 'tiingo.fx.top[].quoteTimestamp',
      candleTimestamp: 'tiingo.fx.prices[].date',
      providerReceivedAt: 'will.local_clock_after_offline_payload_parse'
    }
  }, { maxAgeMs: 30_000, now: receivedAtMs });

  if (base.status !== 'OK') return { ...base, quoteAgeMs };
  return {
    ...base,
    status: 'INVALID',
    valid: false,
    reason: 'CANDLE_COMPLETENESS_UNVERIFIED',
    quoteAgeMs
  };
}

