import { normalizeMarketSnapshot } from '../marketAdapter.js';

const BASE_URL = 'https://api.twelvedata.com';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function standardDeviation(values) {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function priceActionFlags(values, { sma12, noise }) {
  // Twelve Data sends newest first. Price action requires chronological candles
  // and is deliberately unavailable when OHLC fields are incomplete.
  const candles = values.map((value) => ({
    open: num(value.open), high: num(value.high), low: num(value.low), close: num(value.close)
  })).filter((candle) => Object.values(candle).every((value) => value !== null)).reverse();
  if (candles.length < 12) {
    return { breakout: false, rejection: false, pullback: false, reversal: false, patternDirection: 0, patternModel: 'ohlc-v1' };
  }

  const last = candles.at(-1);
  const previous = candles.at(-2);
  const lookback = candles.slice(-11, -1);
  const high = Math.max(...lookback.map((candle) => candle.high));
  const low = Math.min(...lookback.map((candle) => candle.low));
  const breakoutDirection = last.close > high ? 1 : last.close < low ? -1 : 0;
  const range = Math.max(last.high - last.low, Number.EPSILON);
  const body = Math.abs(last.close - last.open);
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const closePosition = (last.close - last.low) / range;
  const bullishRejection = lowerWick >= Math.max(body * 2, range * 0.45) && closePosition >= 0.65;
  const bearishRejection = upperWick >= Math.max(body * 2, range * 0.45) && closePosition <= 0.35;
  const priorClose = candles.at(-4).close;
  const trendDirection = Math.sign(last.close - sma12);
  const recentDirection = Math.sign(last.close - priorClose);
  // A pullback is a counter-trend move with meaningful magnitude. It is not
  // itself an entry; the existing trend, score and confidence gates still apply.
  const pullback = trendDirection !== 0 && recentDirection !== 0
    && trendDirection !== recentDirection
    && Math.abs((last.close - priorClose) / priorClose) >= noise * 0.5;
  const priorMove = previous.close - candles.at(-5).close;
  const latestMove = last.close - previous.close;
  const reversalDirection = Math.sign(latestMove);
  const reversal = Math.sign(priorMove) !== 0 && reversalDirection !== 0
    && Math.sign(priorMove) !== reversalDirection
    && Math.abs(latestMove) >= Math.abs(priorMove) * 0.8;
  const patternDirection = breakoutDirection || (bullishRejection ? 1 : bearishRejection ? -1 : 0) || (reversal ? reversalDirection : 0);

  return {
    breakout: Boolean(breakoutDirection),
    rejection: bullishRejection || bearishRejection,
    pullback,
    reversal,
    patternDirection,
    patternModel: 'ohlc-v1'
  };
}

async function fetchTwelveData(fetchImpl, url, options) {
  try {
    return await fetchImpl(url, options);
  } catch (error) {
    const detail = error?.cause?.code || error?.cause?.message || error?.message || 'erro de rede desconhecido';
    throw new Error(`Twelve Data network error: ${detail}`);
  }
}

function httpError(operation, response) {
  const error = new Error(`Twelve Data ${operation} HTTP ${response.status}`);
  error.status = response.status;
  const retryAfter = Number(response.headers?.get?.('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) error.retryAfterMs = retryAfter * 1_000;
  return error;
}

/**
 * Converts price movement into a scale-free representation.  A 0.02% move
 * means something very different in EUR/USD and BTC/USD; its size relative to
 * the recent noise is the useful evidence.  The resulting factors remain in
 * the existing -1..1 contract used by the deterministic engine.
 */
export function deriveTechnical(values) {
  const closes = values.map((v) => num(v.close)).filter((v) => v !== null).reverse();
  if (closes.length < 12) throw new Error('Histórico insuficiente para análise técnica.');

  const last = closes.at(-1);
  const sma5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const sma12 = closes.slice(-12).reduce((a, b) => a + b, 0) / 12;
  const returns = closes.slice(1).map((v, i) => (v - closes[i]) / closes[i]).filter(Number.isFinite);
  const meanAbsoluteReturn = returns.reduce((sum, value) => sum + Math.abs(value), 0) / returns.length;
  const realizedVolatility = standardDeviation(returns);
  // The floor prevents a perfectly flat or rounded feed from creating an
  // artificial infinite-strength trend.
  const noise = Math.max(realizedVolatility, meanAbsoluteReturn * 0.35, Number.EPSILON);
  const trend = clamp(((last - sma12) / sma12) / (noise * 2.5), -1, 1);
  const momentum = clamp(((last - closes.at(-6)) / closes.at(-6)) / (noise * Math.sqrt(5) * 1.75), -1, 1);
  const recent = closes.slice(-10);
  const range = Math.max(...recent) - Math.min(...recent);
  const structure = clamp(range > 0 ? ((last - Math.min(...recent)) / range) * 2 - 1 : 0, -1, 1);
  const recentVolatility = standardDeviation(returns.slice(-8));
  // This is a relative volatility regime, not raw percentage volatility:
  // 0.5 means normal recent pace, while 1 flags a pace at least twice the
  // recent baseline.  It therefore works across FX, crypto and equities.
  const volatility = realizedVolatility <= Number.EPSILON
    ? 0
    : clamp(recentVolatility / (realizedVolatility * 2), 0, 1);

  const directionalVotes = [
    Math.abs(trend) >= 0.15 ? Math.sign(trend) : 0,
    Math.abs(momentum) >= 0.15 ? Math.sign(momentum) : 0,
    Math.abs(structure) >= 0.25 ? Math.sign(structure) : 0,
    Math.sign(last - sma5) !== 0 && Math.sign(last - sma5) === Math.sign(last - sma12) ? Math.sign(last - sma5) : 0
  ].filter(Boolean);
  const voteSum = directionalVotes.reduce((sum, value) => sum + value, 0);
  const dominant = Math.abs(voteSum) >= 2 ? Math.sign(voteSum) : 0;

  return {
    trend,
    momentum,
    structure,
    volatility,
    confirmations: dominant ? directionalVotes.filter((v) => v === dominant).length : 0,
    candleCount: closes.length,
    technicalModel: 'relative-noise-v1',
    realizedVolatility,
    ...priceActionFlags(values, { sma12, noise })
  };
}

function snapshotFromApi(asset, timeframe, quote, series, maxAgeMs) {
  if (quote?.status === 'error') throw new Error(`Twelve Data quote: ${quote.message || 'erro'}`);
  if (series?.status === 'error') throw new Error(`Twelve Data time_series: ${series.message || 'erro'}`);
  const price = num(quote?.close ?? quote?.price);
  if (!price || !Array.isArray(series?.values) || !series.values.length) throw new Error('Twelve Data retornou snapshot incompleto.');
  const candleDate = series.values[0]?.datetime;
  const candleTimestamp = candleDate
    ? new Date(/[zZ]|[+-]\d\d:\d\d$/.test(candleDate) ? candleDate : `${candleDate.replace(' ', 'T')}Z`).toISOString()
    : null;
  const rawQuoteTime = quote.last_quote_at ?? quote.timestamp;
  const quoteTimestamp = rawQuoteTime ? new Date(Number(rawQuoteTime) * 1000).toISOString() : null;
  if (!candleTimestamp || !quoteTimestamp) throw new Error('Twelve Data não retornou timestamp válido.');
  return normalizeMarketSnapshot({
    asset, timeframe, price, timestamp: quoteTimestamp, candleTimestamp, quoteTimestamp,
    candles: series.values, source: 'twelvedata', marketOpen: Boolean(quote.is_market_open),
    lastQuoteAt: quote.last_quote_at, ...deriveTechnical(series.values)
  }, { maxAgeMs });
}

function entryFor(payload, asset) {
  return payload?.[asset] ?? payload?.[asset.toUpperCase()] ?? null;
}

export function createTwelveDataProvider({
  apiKey = process.env.TWELVEDATA_API_KEY,
  fetchImpl = fetch,
  maxAgeMs = Number(process.env.MARKET_MAX_AGE_MS || 30_000),
  baseUrl = BASE_URL
} = {}) {
  if (!apiKey) throw new Error('TWELVEDATA_API_KEY não configurada.');

  return {
    async getSnapshot(asset, timeframe = '1min', outputsize = 50) {
      const symbol = encodeURIComponent(asset);
      const interval = encodeURIComponent(timeframe);
      const headers = { Authorization: `apikey ${apiKey}` };
      const [quoteResponse, seriesResponse] = await Promise.all([
        fetchTwelveData(fetchImpl, `${baseUrl}/quote?symbol=${symbol}`, { headers, cache: 'no-store' }),
        fetchTwelveData(fetchImpl, `${baseUrl}/time_series?symbol=${symbol}&interval=${interval}&outputsize=${outputsize}&timezone=UTC`, { headers, cache: 'no-store' })
      ]);
      if (!quoteResponse.ok) throw httpError('quote', quoteResponse);
      if (!seriesResponse.ok) throw httpError('time_series', seriesResponse);

      const [quote, series] = await Promise.all([quoteResponse.json(), seriesResponse.json()]);
      return snapshotFromApi(asset, timeframe, quote, series, maxAgeMs);
    },

    async getSnapshots(assets, timeframe = '1min', outputsize = 50) {
      const symbols = [...new Set((assets || []).map((asset) => String(asset).trim().toUpperCase()).filter(Boolean))];
      if (!symbols.length) return [];
      if (symbols.length === 1) {
        try { return [{ asset: symbols[0], snapshot: await this.getSnapshot(symbols[0], timeframe, outputsize), error: null }]; }
        catch (error) { return [{ asset: symbols[0], snapshot: null, error: error.message }]; }
      }
      const joinedSymbols = encodeURIComponent(symbols.join(','));
      const interval = encodeURIComponent(timeframe);
      const headers = { Authorization: `apikey ${apiKey}` };
      const [quoteResponse, seriesResponse] = await Promise.all([
        fetchTwelveData(fetchImpl, `${baseUrl}/quote?symbol=${joinedSymbols}`, { headers, cache: 'no-store' }),
        fetchTwelveData(fetchImpl, `${baseUrl}/time_series?symbol=${joinedSymbols}&interval=${interval}&outputsize=${outputsize}&timezone=UTC`, { headers, cache: 'no-store' })
      ]);
      if (!quoteResponse.ok) throw httpError('quote', quoteResponse);
      if (!seriesResponse.ok) throw httpError('time_series', seriesResponse);
      const [quotes, seriesBySymbol] = await Promise.all([quoteResponse.json(), seriesResponse.json()]);
      return symbols.map((asset) => {
        try {
          return { asset, snapshot: snapshotFromApi(asset, timeframe, entryFor(quotes, asset), entryFor(seriesBySymbol, asset), maxAgeMs), error: null };
        } catch (error) {
          return { asset, snapshot: null, error: error.message };
        }
      });
    }
  };
}
