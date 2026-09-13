import { normalizeMarketSnapshot } from '../marketAdapter.js';

export const SECONDARY_PROVIDER_QUALIFICATION_VERSION = 'secondary-provider-qualification-v1';
export const OANDA_OFFLINE_ADAPTER_VERSION = 'oanda-rest-v20-offline-adapter-v1';
export const OANDA_QUALIFICATION = Object.freeze({
  provider: 'oanda-rest-v20', status: 'QUALIFIED_OFFLINE', liveEligibility: 'EXTERNAL_UNVERIFIED',
  canonicalSymbol: 'EUR/USD', providerSymbol: 'EUR_USD', willTimeframe: '1min', providerGranularity: 'M1',
  priceComponent: 'M', enabledByDefault: false
});

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

export function classifyOandaFailure(error) {
  const status = Number(error?.status);
  if (status === 401 || status === 403) return 'MISCONFIGURED';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500 || /network|timeout|ECONN|ENOTFOUND/i.test(String(error?.message ?? error))) return 'UNAVAILABLE';
  return 'UNAVAILABLE';
}

export function transformOandaOffline({
  candlesResponse, pricingResponse, canonicalSymbol = 'EUR/USD', providerSymbol = 'EUR_USD',
  timeframe = '1min', granularity = 'M1', receivedAt, maxAgeMs = 30_000, priceComponent = 'M'
} = {}) {
  if (canonicalSymbol !== 'EUR/USD' || providerSymbol !== 'EUR_USD') fail('OANDA_SYMBOL_MAPPING_MISMATCH');
  if (timeframe !== '1min' || granularity !== 'M1') fail('OANDA_TIMEFRAME_MAPPING_MISMATCH');
  if (priceComponent !== 'M') fail('OANDA_PRICE_COMPONENT_UNSUPPORTED');
  if (candlesResponse?.instrument !== providerSymbol) fail('OANDA_RESPONSE_SYMBOL_MISMATCH');
  if (candlesResponse?.granularity !== granularity) fail('OANDA_RESPONSE_TIMEFRAME_MISMATCH');
  const receivedAtMs = Date.parse(receivedAt ?? '');
  if (!Number.isFinite(receivedAtMs)) fail('OANDA_PROVIDER_RECEIVED_AT_MISSING');
  const priceEntry = pricingResponse?.prices?.find((entry) => entry?.instrument === providerSymbol);
  const quoteTimestamp = priceEntry?.time;
  if (!Number.isFinite(Date.parse(quoteTimestamp ?? ''))) fail('OANDA_QUOTE_TIMESTAMP_MISSING');
  const bid = number(priceEntry?.closeoutBid);
  const ask = number(priceEntry?.closeoutAsk);
  if (bid === null || ask === null || bid <= 0 || ask <= 0) fail('OANDA_QUOTE_MALFORMED');
  const complete = (candlesResponse?.candles || []).filter((candle) => candle?.complete === true)
    .sort((left, right) => Date.parse(right?.time ?? '') - Date.parse(left?.time ?? ''));
  if (!complete.length) fail('OANDA_COMPLETE_CANDLE_MISSING');
  const mapped = complete.map((candle) => {
    const values = candle?.mid;
    const result = { datetime: candle?.time, open: number(values?.o), high: number(values?.h), low: number(values?.l), close: number(values?.c), volume: number(candle?.volume) };
    if (!Number.isFinite(Date.parse(result.datetime ?? '')) || [result.open, result.high, result.low, result.close].some((value) => value === null)) fail('OANDA_OHLC_MALFORMED');
    return result;
  });
  const latest = mapped.at(0);
  const snapshot = normalizeMarketSnapshot({
    asset: providerSymbol, timeframe, price: (bid + ask) / 2, timestamp: quoteTimestamp,
    quoteTimestamp, candleTimestamp: latest.datetime, latestCandleTimestamp: latest.datetime,
    latestClosedCandleTimestamp: latest.datetime, candles: mapped, source: 'oanda-rest-v20',
    providerReceivedAt: new Date(receivedAtMs).toISOString(), candleCompleteness: 'VERIFIED_CLOSED',
    freshnessBasis: 'REST_QUOTE_TIMESTAMP', freshnessPolicyVersion: 'rest-quote-freshness-v1', freshnessMaxAgeMs: maxAgeMs,
    quoteAgeMs: receivedAtMs - Date.parse(quoteTimestamp), candleAgeMs: receivedAtMs - Date.parse(latest.datetime),
    priceComponent: 'MIDPOINT_FROM_CLOSEOUT_BID_ASK', qualificationVersion: SECONDARY_PROVIDER_QUALIFICATION_VERSION,
    adapterVersion: OANDA_OFFLINE_ADAPTER_VERSION,
    timestampOrigins: {
      quoteTimestamp: 'oanda.pricing.prices[].time',
      candleTimestamp: 'oanda.instruments.candles[].time[complete=true]',
      providerReceivedAt: 'will.local_clock_after_offline_payload_parse'
    }
  }, { maxAgeMs, now: receivedAtMs });
  return { ...snapshot, quoteAgeMs: receivedAtMs - Date.parse(quoteTimestamp), candleAgeMs: receivedAtMs - Date.parse(latest.datetime) };
}
