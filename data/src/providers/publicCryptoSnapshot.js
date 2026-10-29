import { normalizeMarketSnapshot } from '../marketAdapter.js';
import { deriveTechnical } from './twelveDataProvider.js';

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/**
 * Normalize an exchange spot quote and completed OHLC candles. Provider event
 * time is preserved independently from local receive time.
 */
export function buildPublicCryptoSnapshot({
  asset,
  timeframe,
  price,
  quoteTimestamp,
  quoteTimestampField,
  candles,
  source,
  venue,
  quoteCurrency,
  intervalSeconds,
  maxAgeMs = 15_000,
  maxCandles = 200,
  now = Date.now()
} = {}) {
  const quoteMs = Date.parse(quoteTimestamp ?? '');
  const normalizedPrice = finitePositive(price);
  if (!normalizedPrice || !Number.isFinite(quoteMs)) throw new Error('PUBLIC_CRYPTO_QUOTE_INVALID');
  if (quoteMs > now + 2_000) throw new Error('PUBLIC_CRYPTO_QUOTE_FROM_FUTURE');
  if (!Array.isArray(candles)) throw new Error('PUBLIC_CRYPTO_CANDLES_INVALID');
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 1) throw new Error('PUBLIC_CRYPTO_INTERVAL_INVALID');

  const seen = new Set();
  const completed = [];
  for (const [index, candle] of candles.entries()) {
    const openMs = Number(candle?.openTimestampMs);
    const closeMs = Number(candle?.closeTimestampMs);
    const open = finitePositive(candle?.open);
    const high = finitePositive(candle?.high);
    const low = finitePositive(candle?.low);
    const close = finitePositive(candle?.close);
    const volume = candle?.volume === undefined || candle?.volume === null || candle?.volume === ''
      ? null : Number(candle.volume);
    if (!Number.isFinite(openMs) || !Number.isFinite(closeMs) ||
        ![open, high, low, close].every(Number.isFinite) ||
        (volume !== null && (!Number.isFinite(volume) || volume < 0)) ||
        high < Math.max(open, close, low) || low > Math.min(open, close, high) ||
        closeMs < openMs || closeMs > openMs + intervalSeconds * 1_000) {
      throw new Error(`PUBLIC_CRYPTO_CANDLE_INVALID:${index}`);
    }
    if (seen.has(openMs)) throw new Error('PUBLIC_CRYPTO_DUPLICATE_CANDLE');
    seen.add(openMs);
    if (closeMs > quoteMs) continue;
    completed.push({ openTimestampMs: openMs, closeTimestampMs: closeMs, open, high, low, close, ...(volume === null ? {} : { volume }) });
  }

  completed.sort((left, right) => right.openTimestampMs - left.openTimestampMs);
  const selected = completed.slice(0, Math.max(12, Math.min(200, Number(maxCandles) || 50)));
  if (selected.length < 12) throw new Error('PUBLIC_CRYPTO_COMPLETED_CANDLES_INSUFFICIENT');

  const bars = selected.map((bar) => ({
    datetime: new Date(bar.openTimestampMs).toISOString(),
    open: bar.open, high: bar.high, low: bar.low, close: bar.close,
    ...(bar.volume === undefined ? {} : { volume: bar.volume })
  }));
  const quoteISO = new Date(quoteMs).toISOString();
  const candleISO = bars[0].datetime;
  const receivedISO = new Date(now).toISOString();
  const raw = {
    asset: String(asset).trim().toUpperCase(),
    timeframe,
    price: normalizedPrice,
    timestamp: quoteISO,
    quoteTimestamp: quoteISO,
    source,
    marketVenue: venue,
    marketType: 'SPOT',
    quoteCurrency,
    marketOpen: true,
    providerReceivedAt: receivedISO,
    quoteAgeMs: now - quoteMs,
    candles: bars,
    candleTimestamp: candleISO,
    latestCandleTimestamp: candleISO,
    // CanonicalMarketSnapshot treats latestClosedCandleTimestamp as the timestamp
    // of the last closed candle (its open time); retain the actual close boundary separately.
    latestClosedCandleTimestamp: candleISO,
    latestClosedCandleCloseTimestamp: new Date(selected[0].closeTimestampMs).toISOString(),
    candleAgeMs: now - Date.parse(candleISO),
    candleCompleteness: source === 'coinbase-exchange-rest'
      ? 'VERIFIED_CLOSED_BY_COINBASE_EVENT_TIME'
      : 'VERIFIED_CLOSED_BY_BINANCE_EVENT_TIME',
    freshnessBasis: `${source.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_EXCHANGE_EVENT_TIME`,
    freshnessPolicyVersion: 'rest-quote-freshness-v1',
    freshnessMaxAgeMs: maxAgeMs,
    timestampOrigins: {
      quoteTimestamp: source === 'coinbase-exchange-rest'
        ? 'coinbase.exchange.product.ticker.time'
        : 'binance.spot.recentTrade.time',
      quoteTimestampField,
      candleTimestamp: source === 'coinbase-exchange-rest'
        ? 'coinbase.exchange.product.candles.openTime'
        : 'binance.spot.klines.openTime',
      candleCloseTimestamp: source === 'coinbase-exchange-rest'
        ? 'coinbase.exchange.product.candles.openTime_plus_granularity'
        : 'binance.spot.klines.closeTime',
      providerReceivedAt: 'will.local_clock_after_response_parse'
    },
    providerTiming: {
      evaluatedAt: receivedISO,
      quoteAgeAtReceiptMs: now - quoteMs,
      candleAgeAtReceiptMs: now - Date.parse(candleISO),
      providerLatencyMs: null,
      providerLatencyStatus: 'NOT_MEASURABLE_FROM_REST_PAYLOAD'
    },
    ...deriveTechnical(bars)
  };
  return normalizeMarketSnapshot(raw, { maxAgeMs, now });
}
