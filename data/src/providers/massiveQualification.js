import { normalizeMarketSnapshot } from '../marketAdapter.js';

export const MASSIVE_QUALIFICATION_VERSION = 'massive-fx-offline-qualification-v1';
export const MASSIVE_QUALIFICATION = Object.freeze({
  provider: 'massive-currencies',
  status: 'QUALIFIED_OFFLINE_WITH_LIMITATIONS',
  canonicalSymbol: 'EUR/USD',
  restAggregateTicker: 'C:EURUSD',
  restHistoricalQuoteTicker: 'C:EUR-USD',
  restLastQuotePath: Object.freeze({ from: 'EUR', to: 'USD' }),
  websocketSubscriptionTicker: 'EUR-USD',
  websocketPayloadPair: 'EUR/USD',
  multiplier: 1,
  timespan: 'minute',
  candleCompleteness: 'UNVERIFIED_BY_PROVIDER_PAYLOAD',
  verifiedClosedEligibility: false,
  enabledByDefault: false
});

const numeric = (value) => value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

export function classifyMassiveFailure(error) {
  const status = Number(error?.status);
  if (status === 401 || status === 403) return 'MISCONFIGURED';
  if (status === 429) return 'RATE_LIMITED';
  return 'UNAVAILABLE';
}

export function transformMassiveFxOffline({
  aggregatesResponse,
  lastQuoteResponse,
  websocketAggregate = null,
  canonicalSymbol = 'EUR/USD',
  restAggregateTicker = 'C:EURUSD',
  restLastQuotePath = { from: 'EUR', to: 'USD' },
  timeframe = '1min',
  multiplier = 1,
  timespan = 'minute',
  receivedAt,
  maxAgeMs = 30_000
} = {}) {
  if (canonicalSymbol !== MASSIVE_QUALIFICATION.canonicalSymbol || restAggregateTicker !== MASSIVE_QUALIFICATION.restAggregateTicker ||
      restLastQuotePath?.from !== 'EUR' || restLastQuotePath?.to !== 'USD') fail('MASSIVE_SYMBOL_MAPPING_MISMATCH');
  if (timeframe !== '1min' || multiplier !== 1 || timespan !== 'minute') fail('MASSIVE_TIMEFRAME_MAPPING_MISMATCH');
  if (maxAgeMs !== 30_000) fail('MASSIVE_FRESHNESS_GATE_FROZEN');

  const receivedAtMs = Date.parse(receivedAt ?? '');
  if (!Number.isFinite(receivedAtMs)) fail('MASSIVE_PROVIDER_RECEIVED_AT_MISSING');
  if (aggregatesResponse?.ticker !== restAggregateTicker) fail('MASSIVE_RESPONSE_SYMBOL_MISMATCH');
  if (lastQuoteResponse?.symbol !== canonicalSymbol) fail('MASSIVE_RESPONSE_SYMBOL_MISMATCH');

  const quoteTimestampMs = numeric(lastQuoteResponse?.last?.timestamp);
  const bid = numeric(lastQuoteResponse?.last?.bid);
  const ask = numeric(lastQuoteResponse?.last?.ask);
  if (quoteTimestampMs === null) fail('MASSIVE_QUOTE_TIMESTAMP_MISSING');
  if ([bid, ask].some((value) => value === null || value <= 0) || bid > ask) fail('MASSIVE_QUOTE_MALFORMED');

  if (!Array.isArray(aggregatesResponse?.results) || !aggregatesResponse.results.length) fail('MASSIVE_OHLC_MISSING');
  const candles = aggregatesResponse.results.map((bar) => {
    const mapped = {
      datetime: new Date(numeric(bar?.t)).toISOString(),
      open: numeric(bar?.o), high: numeric(bar?.h), low: numeric(bar?.l), close: numeric(bar?.c),
      windowStartTimestamp: numeric(bar?.t)
    };
    if (mapped.windowStartTimestamp === null || !Number.isFinite(Date.parse(mapped.datetime)) ||
        [mapped.open, mapped.high, mapped.low, mapped.close].some((value) => value === null) ||
        mapped.low > mapped.high || mapped.open < mapped.low || mapped.open > mapped.high ||
        mapped.close < mapped.low || mapped.close > mapped.high) fail('MASSIVE_OHLC_MALFORMED');
    return mapped;
  }).sort((left, right) => right.windowStartTimestamp - left.windowStartTimestamp);

  let websocketWindow = null;
  if (websocketAggregate !== null) {
    const start = numeric(websocketAggregate?.s);
    const end = numeric(websocketAggregate?.e);
    if (websocketAggregate?.ev !== 'CA' || websocketAggregate?.pair !== MASSIVE_QUALIFICATION.websocketPayloadPair) fail('MASSIVE_WS_MAPPING_MISMATCH');
    if (start === null || end === null || end <= start) fail('MASSIVE_WS_TIMESTAMP_INVALID');
    websocketWindow = {
      startTimestamp: start,
      endTimestamp: end,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      completeness: 'WINDOW_END_ONLY_NOT_FINALIZATION_PROOF'
    };
  }

  const latest = candles[0];
  const quoteTimestamp = new Date(quoteTimestampMs).toISOString();
  const base = normalizeMarketSnapshot({
    asset: restAggregateTicker,
    timeframe,
    price: (bid + ask) / 2,
    timestamp: quoteTimestamp,
    quoteTimestamp,
    candleTimestamp: latest.datetime,
    latestCandleTimestamp: latest.datetime,
    latestClosedCandleTimestamp: null,
    candles,
    source: 'massive-currencies',
    providerReceivedAt: new Date(receivedAtMs).toISOString(),
    candleCompleteness: 'UNVERIFIED_BY_PROVIDER_PAYLOAD',
    verifiedClosedEligibility: false,
    aggregatePriceOrigin: 'BEST_BID_OFFER_QUOTES_NOT_TRADES',
    noQuoteNoBarSemantics: true,
    websocketWindow,
    freshnessBasis: 'REST_LAST_QUOTE_TIMESTAMP',
    freshnessPolicyVersion: 'rest-quote-freshness-v1',
    freshnessMaxAgeMs: 30_000,
    quoteAgeMs: receivedAtMs - quoteTimestampMs,
    candleAgeMs: receivedAtMs - latest.windowStartTimestamp,
    qualificationVersion: MASSIVE_QUALIFICATION_VERSION,
    timestampOrigins: {
      quoteTimestamp: 'massive.rest.last_quote.last.timestamp[unix_ms]',
      candleTimestamp: 'massive.rest.aggregates.results[].t[window_start_unix_ms]',
      websocketWindowStart: 'massive.websocket.CA.s[unix_ms]',
      websocketWindowEnd: 'massive.websocket.CA.e[unix_ms]',
      providerReceivedAt: 'will.local_clock_after_offline_payload_parse'
    }
  }, { maxAgeMs: 30_000, now: receivedAtMs });

  if (base.status !== 'OK') return base;
  return { ...base, status: 'INVALID', valid: false, reason: 'CANDLE_COMPLETENESS_UNVERIFIED' };
}

