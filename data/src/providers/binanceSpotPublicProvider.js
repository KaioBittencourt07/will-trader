import { addProviderEfficiency } from '../providerEfficiency.js';
import { buildPublicCryptoSnapshot } from './publicCryptoSnapshot.js';

export const BINANCE_SPOT_PUBLIC_PROVIDER_VERSION = 'binance-spot-public-market-data-v1';
export const BINANCE_PUBLIC_SPOT_SYMBOLS = Object.freeze({
  'BTC/USDT': 'BTCUSDT', 'ETH/USDT': 'ETHUSDT', 'SOL/USDT': 'SOLUSDT',
  'XRP/USDT': 'XRPUSDT', 'ADA/USDT': 'ADAUSDT', 'DOGE/USDT': 'DOGEUSDT',
  'AVAX/USDT': 'AVAXUSDT', 'LINK/USDT': 'LINKUSDT', 'LTC/USDT': 'LTCUSDT',
  'BCH/USDT': 'BCHUSDT', 'DOT/USDT': 'DOTUSDT'
});
const INTERVALS = Object.freeze({
  '1min': { seconds: 60, api: '1m' }, '5min': { seconds: 300, api: '5m' },
  '15min': { seconds: 900, api: '15m' }, '30min': { seconds: 1_800, api: '30m' },
  '1h': { seconds: 3_600, api: '1h' }, '2h': { seconds: 7_200, api: '2h' },
  '4h': { seconds: 14_400, api: '4h' }, '1day': { seconds: 86_400, api: '1d' }
});
function positiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}
function providerError(status, headers) {
  const error = new Error(`BINANCE_SPOT_PUBLIC_HTTP_${status}`);
  error.status = status;
  const retryAfter = headers?.get?.('retry-after');
  if (retryAfter !== null && retryAfter !== undefined && Number.isFinite(Number(retryAfter))) error.retryAfterMs = Math.max(0, Number(retryAfter) * 1_000);
  error.code = status === 429 || status === 418 ? 'BINANCE_PUBLIC_RATE_LIMITED' : 'BINANCE_PUBLIC_HTTP_ERROR';
  return error;
}
export function binancePublicSymbolFor(asset) {
  return BINANCE_PUBLIC_SPOT_SYMBOLS[String(asset ?? '').trim().toUpperCase()] ?? null;
}
export function createBinanceSpotPublicProvider({
  fetchImpl = fetch, now = () => Date.now(), baseUrl = 'https://data-api.binance.vision',
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
      catch { throw new Error('BINANCE_SPOT_PUBLIC_JSON_INVALID'); }
    } catch (error) {
      if (error?.status) throw error;
      const normalized = new Error(error?.name === 'TimeoutError' || error?.name === 'AbortError'
        ? 'BINANCE_SPOT_PUBLIC_TIMEOUT' : 'BINANCE_SPOT_PUBLIC_UNAVAILABLE');
      normalized.code = error?.name === 'TimeoutError' || error?.name === 'AbortError'
        ? 'BINANCE_PUBLIC_TIMEOUT' : 'BINANCE_PUBLIC_UNAVAILABLE';
      throw normalized;
    } finally {
      addProviderEfficiency(telemetry, { externalRequests: 1, externalLatencyMs: Math.max(0, now() - startedAt), creditsEstimated: 0 });
    }
  }
  async function getSnapshot(asset, timeframe = '1min', outputsize = 50, { telemetry } = {}) {
    const canonical = String(asset ?? '').trim().toUpperCase();
    const symbol = binancePublicSymbolFor(canonical);
    if (!symbol) throw new Error('BINANCE_PUBLIC_SYMBOL_UNSUPPORTED');
    const interval = INTERVALS[String(timeframe ?? '').trim()];
    if (!interval) throw new Error('BINANCE_PUBLIC_TIMEFRAME_UNSUPPORTED');
    const count = positiveInteger(outputsize, 50, 200);
    const nowMs = now();
    const query = new URLSearchParams({ symbol, endTime: String(nowMs), limit: String(count + 2), interval: interval.api });
    const base = String(baseUrl).replace(/\/$/, '');
    const tradeUrl = `${base}/api/v3/trades?symbol=${encodeURIComponent(symbol)}&limit=1`;
    const candlesUrl = `${base}/api/v3/klines?${query.toString()}`;
    const [trades, rawCandles] = await Promise.all([getJson(tradeUrl, telemetry), getJson(candlesUrl, telemetry)]);
    const trade = Array.isArray(trades) ? trades[0] : null;
    const price = Number(trade?.price);
    const tradeTimeMs = Number(trade?.time);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(tradeTimeMs) || tradeTimeMs <= 0) throw new Error('BINANCE_PUBLIC_TRADE_INVALID');
    if (!Array.isArray(rawCandles)) throw new Error('BINANCE_PUBLIC_CANDLES_INVALID');
    const candles = rawCandles.map((row, index) => {
      if (!Array.isArray(row) || row.length < 7) throw new Error(`BINANCE_PUBLIC_CANDLE_INVALID:${index}`);
      return {
        openTimestampMs: Number(row[0]), closeTimestampMs: Number(row[6]),
        open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5]
      };
    });
    return buildPublicCryptoSnapshot({
      asset: canonical, timeframe, price, quoteTimestamp: new Date(tradeTimeMs).toISOString(),
      quoteTimestampField: 'trades[0].time', candles, source: 'binance-spot-rest',
      venue: 'BINANCE_SPOT', quoteCurrency: 'USDT', intervalSeconds: interval.seconds,
      maxAgeMs: freshForMs, maxCandles: count, now: now()
    });
  }
  return Object.freeze({
    providerId: 'binance-spot-rest', version: BINANCE_SPOT_PUBLIC_PROVIDER_VERSION,
    publicDataOnly: true, apiKeyRequired: false,
    supportsAsset: (asset) => Boolean(binancePublicSymbolFor(asset)),
    estimateCreditsForAssets: () => 0,
    estimateHttpRequestsForAssets: (assets = []) => [...new Set(assets.map((asset) => String(asset).trim().toUpperCase()))].length * 2,
    getSnapshot,

  });
}
