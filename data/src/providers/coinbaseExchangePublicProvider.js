import { addProviderEfficiency } from '../providerEfficiency.js';
import { buildPublicCryptoSnapshot } from './publicCryptoSnapshot.js';

export const COINBASE_EXCHANGE_PUBLIC_PROVIDER_VERSION = 'coinbase-exchange-public-spot-v1';
export const COINBASE_PUBLIC_SPOT_PRODUCTS = Object.freeze({
  'BTC/USD': 'BTC-USD',
  'ETH/USD': 'ETH-USD',
  'SOL/USD': 'SOL-USD',
  'XRP/USD': 'XRP-USD'
});
const INTERVALS = Object.freeze({
  '1min': { seconds: 60 },
  '5min': { seconds: 300 },
  '15min': { seconds: 900 },
  '1h': { seconds: 3_600 },
  '6h': { seconds: 21_600 },
  '1day': { seconds: 86_400 }
});
function positiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}
function providerError(status, headers) {
  const error = new Error(`COINBASE_EXCHANGE_PUBLIC_HTTP_${status}`);
  error.status = status;
  const retryAfter = headers?.get?.('retry-after');
  if (retryAfter !== null && retryAfter !== undefined && Number.isFinite(Number(retryAfter))) error.retryAfterMs = Math.max(0, Number(retryAfter) * 1_000);
  error.code = status === 429 ? 'COINBASE_PUBLIC_RATE_LIMITED' : 'COINBASE_PUBLIC_HTTP_ERROR';
  return error;
}
export function coinbasePublicProductFor(asset) {
  return COINBASE_PUBLIC_SPOT_PRODUCTS[String(asset ?? '').trim().toUpperCase()] ?? null;
}
export function createCoinbaseExchangePublicProvider({
  fetchImpl = fetch, now = () => Date.now(), baseUrl = 'https://api.exchange.coinbase.com',
  timeoutMs = 8_000, maxAgeMs = 15_000
} = {}) {
  const timeout = positiveInteger(timeoutMs, 8_000, 15_000);
  const freshForMs = positiveInteger(maxAgeMs, 15_000, 60_000);
  async function getJson(url, telemetry) {
    const startedAt = now();
    try {
      const response = await fetchImpl(url, {
        method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store',
        signal: AbortSignal.timeout(timeout)
      });
      if (!response?.ok) throw providerError(response?.status ?? 0, response?.headers);
      try { return await response.json(); }
      catch { throw new Error('COINBASE_EXCHANGE_PUBLIC_JSON_INVALID'); }
    } catch (error) {
      if (error?.status) throw error;
      const normalized = new Error(error?.name === 'TimeoutError' || error?.name === 'AbortError'
        ? 'COINBASE_EXCHANGE_PUBLIC_TIMEOUT' : 'COINBASE_EXCHANGE_PUBLIC_UNAVAILABLE');
      normalized.code = error?.name === 'TimeoutError' || error?.name === 'AbortError'
        ? 'COINBASE_PUBLIC_TIMEOUT' : 'COINBASE_PUBLIC_UNAVAILABLE';
      throw normalized;
    } finally {
      addProviderEfficiency(telemetry, { externalRequests: 1, externalLatencyMs: Math.max(0, now() - startedAt), creditsEstimated: 0 });
    }
  }
  async function getSnapshot(asset, timeframe = '1min', outputsize = 50, { telemetry } = {}) {
    const canonical = String(asset ?? '').trim().toUpperCase();
    const product = coinbasePublicProductFor(canonical);
    if (!product) throw new Error('COINBASE_PUBLIC_SYMBOL_UNSUPPORTED');
    const interval = INTERVALS[String(timeframe ?? '').trim()];
    if (!interval) throw new Error('COINBASE_PUBLIC_TIMEFRAME_UNSUPPORTED');
    const count = positiveInteger(outputsize, 50, 200);
    const endMs = now();
    const startMs = endMs - interval.seconds * 1_000 * (count + 2);
    const base = String(baseUrl).replace(/\/$/, '');
    const productPath = `/products/${encodeURIComponent(product)}`;
    const tickerUrl = `${base}${productPath}/ticker`;
    const params = new URLSearchParams({
      start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(),
      granularity: String(interval.seconds)
    });
    const candlesUrl = `${base}${productPath}/candles?${params.toString()}`;
    const [ticker, rawCandles] = await Promise.all([getJson(tickerUrl, telemetry), getJson(candlesUrl, telemetry)]);
    const price = Number(ticker?.price);
    const timestamp = typeof ticker?.time === 'string' ? ticker.time : '';
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(Date.parse(timestamp))) throw new Error('COINBASE_PUBLIC_TICKER_INVALID');
    if (!Array.isArray(rawCandles)) throw new Error('COINBASE_PUBLIC_CANDLES_INVALID');
    const candles = rawCandles.map((row, index) => {
      if (!Array.isArray(row) || row.length < 6) throw new Error(`COINBASE_PUBLIC_CANDLE_INVALID:${index}`);
      return {
        openTimestampMs: Number(row[0]) * 1_000, closeTimestampMs: Number(row[0]) * 1_000 + interval.seconds * 1_000,
        low: row[1], high: row[2], open: row[3], close: row[4], volume: row[5]
      };
    });
    return buildPublicCryptoSnapshot({
      asset: canonical, timeframe, price, quoteTimestamp: timestamp, quoteTimestampField: 'ticker.time',
      candles, source: 'coinbase-exchange-rest', venue: 'COINBASE_EXCHANGE', quoteCurrency: 'USD',
      intervalSeconds: interval.seconds, maxAgeMs: freshForMs, maxCandles: count, now: now()
    });
  }
  return Object.freeze({
    providerId: 'coinbase-exchange-rest', version: COINBASE_EXCHANGE_PUBLIC_PROVIDER_VERSION,
    publicDataOnly: true, apiKeyRequired: false,
    supportsAsset: (asset) => Boolean(coinbasePublicProductFor(asset)),
    estimateCreditsForAssets: () => 0,
    estimateHttpRequestsForAssets: (assets = []) => [...new Set(assets.map((asset) => String(asset).trim().toUpperCase()))].length * 2,
    getSnapshot,

  });
}
