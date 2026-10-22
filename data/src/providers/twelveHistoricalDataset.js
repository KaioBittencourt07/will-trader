import { createHash } from 'node:crypto';

export const TWELVE_HISTORICAL_DATASET_VERSION = 'twelve-historical-dataset-v1';
export const TWELVE_HISTORICAL_MAX_POINTS = 5_000;
const BASE_URL = 'https://api.twelvedata.com';
const TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const ASSET_PATTERN = /^[A-Z0-9][A-Z0-9._/-]{0,31}$/;
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

function parseExplicitTimestamp(value) {
  if (typeof value !== 'string' || !TIME_PATTERN.test(value)) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : NaN;
}

function safeProviderKey(value) {
  const key = String(value ?? '').trim();
  if (key.length < 16 || /coloque_sua_chave|configure|your[_ -]?api[_ -]?key|placeholder|example[_ -]?key/i.test(key)) {
    throw new Error('TWELVEDATA_REAL_API_KEY_REQUIRED');
  }
  return key;
}

function positivePrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) throw new Error('HISTORICAL_PRICE_INVALID');
  return price;
}

function parseProviderBarDate(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('HISTORICAL_BAR_TIMESTAMP_MISSING');
  // The request forces timezone=UTC for intraday intervals. The provider may
  // omit the trailing Z in its datetime values; in that case UTC is contractual.
  const raw = value.trim();
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)
    ? raw
    : `${raw.replace(' ', 'T')}Z`;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) throw new Error('HISTORICAL_BAR_TIMESTAMP_INVALID');
  return parsed;
}

async function responseBytes(response) {
  if (typeof response.arrayBuffer === 'function') {
    return Buffer.from(await response.arrayBuffer());
  }
  if (typeof response.text === 'function') {
    return Buffer.from(await response.text(), 'utf8');
  }
  throw new Error('TWELVEDATA_RESPONSE_BODY_UNAVAILABLE');
}

function numericHeader(headers, name) {
  const value = headers?.get?.(name);
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function parseRetryAfter(response) {
  const raw = response.headers?.get?.('retry-after');
  if (!raw) return {};
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return { retryAfterMs: Math.min(seconds * 1_000, 86_400_000) };
  const time = Date.parse(raw);
  if (Number.isFinite(time)) return { retryAfterAt: new Date(time).toISOString() };
  return { retryAfterProvided: true };
}

/**
 * Fetches ONE bounded historical /time_series request only when explicitly
 * called. It never writes files, starts a scanner, changes experiments or
 * performs broker execution. Callers are responsible for storing rawBytes
 * securely and checking their plan's provider budget before fetching.
 *
 * The returned close-price observations use candle CLOSE TIME (bar open +
 * interval duration), never the bar's open timestamp as if the close were
 * already known. Only closed bars inside the requested UTC window are emitted.
 */
export async function fetchTwelveHistoricalDataset({
  apiKey = process.env.TWELVEDATA_API_KEY,
  asset,
  interval,
  startDate,
  endDate,
  maxPoints = TWELVE_HISTORICAL_MAX_POINTS,
  fetchImpl = fetch,
  baseUrl = BASE_URL,
  now = () => Date.now(),
  timeoutMs = 15_000
} = {}) {
  const key = safeProviderKey(apiKey);
  const symbol = typeof asset === 'string' ? asset.trim().toUpperCase() : '';
  if (!ASSET_PATTERN.test(symbol)) throw new Error('HISTORICAL_ASSET_INVALID');

  const timeframe = typeof interval === 'string' ? interval.trim().toLowerCase() : '';
  const barWidthMs = INTERVAL_MS[timeframe];
  if (!barWidthMs) throw new Error('HISTORICAL_INTRADAY_INTERVAL_REQUIRED');

  const startMs = parseExplicitTimestamp(startDate);
  const endMs = parseExplicitTimestamp(endDate);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
    throw new Error('HISTORICAL_WINDOW_INVALID');
  }
  if (!Number.isInteger(maxPoints) || maxPoints < 1 || maxPoints > TWELVE_HISTORICAL_MAX_POINTS) {
    throw new Error('HISTORICAL_MAX_POINTS_OUT_OF_RANGE');
  }
  const estimatedBars = Math.floor((endMs - startMs) / barWidthMs) + 1;
  if (estimatedBars > maxPoints) throw new Error('HISTORICAL_WINDOW_EXCEEDS_POINT_BUDGET');
  const validationNowMs = now();
  if (!Number.isFinite(validationNowMs) || endMs > validationNowMs) {
    throw new Error('HISTORICAL_END_MUST_NOT_BE_IN_FUTURE');
  }
  if (typeof fetchImpl !== 'function') throw new Error('HISTORICAL_FETCH_IMPLEMENTATION_REQUIRED');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    throw new Error('HISTORICAL_TIMEOUT_INVALID');
  }
  let normalizedBase;
  try {
    normalizedBase = new URL(baseUrl);
  } catch {
    throw new Error('HISTORICAL_BASE_URL_INVALID');
  }
  if (normalizedBase.protocol !== 'https:' || normalizedBase.hostname !== 'api.twelvedata.com') {
    throw new Error('HISTORICAL_BASE_URL_NOT_ALLOWED');
  }

  const query = new URLSearchParams({
    symbol,
    interval: timeframe,
    start_date: new Date(startMs).toISOString().replace('.000Z', 'Z'),
    end_date: new Date(endMs).toISOString().replace('.000Z', 'Z'),
    timezone: 'UTC',
    order: 'ASC'
    // Intentionally omit outputsize when start_date/end_date are both present:
    // Twelve Data documents that outputsize can truncate a range-bounded request.
  });
  const url = new URL(`/time_series?${query.toString()}`, normalizedBase);
  const startedAt = now();
  let response;
  try {
    response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: { Authorization: `apikey ${key}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const cause = error?.cause?.code || (error?.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR');
    throw new Error(`TWELVEDATA_HISTORICAL_REQUEST_FAILED:${String(cause).slice(0, 80)}`);
  }

  if (!response.ok) {
    const error = new Error(`TWELVEDATA_HISTORICAL_HTTP_${response.status}`);
    error.status = response.status;
    Object.assign(error, parseRetryAfter(response));
    throw error;
  }

  const rawBytes = await responseBytes(response);
  const rawSha256 = createHash('sha256').update(rawBytes).digest('hex');
  let payload;
  try {
    payload = JSON.parse(rawBytes.toString('utf8'));
  } catch {
    throw new Error('TWELVEDATA_HISTORICAL_JSON_INVALID');
  }
  if (payload?.status === 'error' || !Array.isArray(payload?.values)) {
    throw new Error('TWELVEDATA_HISTORICAL_PAYLOAD_INVALID');
  }
  if (!payload.values.length) throw new Error('TWELVEDATA_HISTORICAL_EMPTY');
  if (payload.values.length > maxPoints || payload.values.length > TWELVE_HISTORICAL_MAX_POINTS) {
    throw new Error('TWELVEDATA_HISTORICAL_POINT_LIMIT_EXCEEDED');
  }

  const seen = new Set();
  const bars = payload.values.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('HISTORICAL_BAR_INVALID');
    const openMs = parseProviderBarDate(row.datetime);
    if (openMs < startMs || openMs >= endMs) throw new Error('HISTORICAL_BAR_OUTSIDE_REQUESTED_WINDOW');
    if (seen.has(openMs)) throw new Error('HISTORICAL_BAR_TIMESTAMP_DUPLICATE');
    seen.add(openMs);
    const open = positivePrice(row.open);
    const high = positivePrice(row.high);
    const low = positivePrice(row.low);
    const close = positivePrice(row.close);
    if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) {
      throw new Error('HISTORICAL_OHLC_INCONSISTENT');
    }
    const closeMs = openMs + barWidthMs;
    return {
      asset: symbol,
      interval: timeframe,
      barOpenTimestamp: new Date(openMs).toISOString(),
      barCloseTimestamp: new Date(closeMs).toISOString(),
      open, high, low, close,
      sourceTimestampSemantics: 'PROVIDER_BAR_OPEN_TIME_CLOSE_KNOWN_ONLY_AT_BAR_CLOSE'
    };
  }).sort((a, b) => Date.parse(a.barOpenTimestamp) - Date.parse(b.barOpenTimestamp));

  const retrievedAtMs = now();
  const closedBars = bars.filter((bar) => Date.parse(bar.barCloseTimestamp) <= retrievedAtMs);
  const observations = closedBars.map((bar) => ({
    asset: bar.asset,
    timestamp: bar.barCloseTimestamp,
    price: bar.close,
    source: 'twelvedata-time-series-historical',
    timeframe: bar.interval,
    barOpenTimestamp: bar.barOpenTimestamp,
    barCloseTimestamp: bar.barCloseTimestamp,
    observationSemantics: 'CLOSED_CANDLE_CLOSE_PRICE_AVAILABLE_AT_CLOSE_TIME'
  }));
  if (!observations.length) throw new Error('TWELVEDATA_HISTORICAL_NO_CLOSED_BARS');

  const from = bars[0].barOpenTimestamp;
  const to = bars.at(-1).barCloseTimestamp;
  return Object.freeze({
    schemaVersion: TWELVE_HISTORICAL_DATASET_VERSION,
    provider: 'twelvedata',
    asset: symbol,
    interval: timeframe,
    requestedWindow: {
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString()
    },
    retrievedAt: new Date(retrievedAtMs).toISOString(),
    elapsedMs: Math.max(0, retrievedAtMs - startedAt),
    requestBudget: {
      apiRequests: 1,
      estimatedApiCredits: 1,
      estimatedCreditsAreOfficialAccountUsage: false,
      providerReportedCreditsUsed: numericHeader(response.headers, 'api-credits-used'),
      providerReportedCreditsLeft: numericHeader(response.headers, 'api-credits-left'),
      note: 'One /time_series request for one symbol. Prefer provider response headers over the estimate.'
    },
    rawDataset: {
      contentType: response.headers?.get?.('content-type') ?? null,
      byteLength: rawBytes.byteLength,
      sha256: rawSha256,
      bytes: rawBytes
    },
    integrityClaim: 'RAW_RESPONSE_HASHED_PROVENANCE_NOT_AUTHENTICATED',
    rowCounts: {
      rawBars: bars.length,
      closedBars: observations.length,
      openOrNotYetClosedBarsExcluded: bars.length - observations.length
    },
    bars,
    observations
  });
}
