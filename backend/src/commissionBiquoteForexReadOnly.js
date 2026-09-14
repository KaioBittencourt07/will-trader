import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = 'https://biquote.io';
const SYMBOLS = Object.freeze([
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'NZDUSD', 'USDCAD', 'GBPJPY'
]);
const FROZEN_FRESHNESS_MS = 30_000;

function finite(value) {
  return value !== null && value !== '' && Number.isFinite(Number(value));
}

function normalizeRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.ticks)) return payload.ticks;
  if (Array.isArray(payload?.data)) return payload.data;

  // Biquote /api/latest returns an object keyed by symbol, e.g.
  // { EURUSD: { ...tick }, GBPUSD: { ...tick } }.
  // Preserve support for array/envelope shapes while also normalizing the
  // documented keyed-map response into rows with an explicit symbol field.
  if (payload && typeof payload === 'object') {
    return Object.entries(payload)
      .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))
      .map(([symbol, value]) => ({
        ...value,
        symbol: String(value.symbol || symbol).toUpperCase()
      }));
  }

  return [];
}

export function assessBiquoteForexCommission(payload, { now = Date.now() } = {}) {
  const rows = normalizeRows(payload);
  const bySymbol = new Map(rows.map((row) => [String(row?.symbol || '').toUpperCase(), row]));
  const assets = SYMBOLS.map((symbol) => {
    const row = bySymbol.get(symbol) ?? null;
    const timestampMs = Date.parse(row?.timestamp ?? '');
    const eventAgeMs = Number.isFinite(timestampMs) ? Math.max(0, Number(now) - timestampMs) : null;
    const quoteAgeMs = finite(row?.quoteAgeSeconds) ? Number(row.quoteAgeSeconds) * 1_000 : null;
    const price = finite(row?.mid) ? Number(row.mid) : null;
    const marketState = String(row?.marketState || '').toLowerCase();
    const reasons = [];

    if (!row) reasons.push('SYMBOL_MISSING');
    if (!(price > 0)) reasons.push('MID_PRICE_INVALID');
    if (!Number.isFinite(timestampMs)) reasons.push('TIMESTAMP_INVALID');
    if (marketState !== 'open') reasons.push('MARKET_NOT_OPEN');
    if (row?.stale !== false) reasons.push('PROVIDER_STALE_FLAG_NOT_FALSE');
    if (quoteAgeMs === null) reasons.push('QUOTE_AGE_UNAVAILABLE');
    else if (quoteAgeMs > FROZEN_FRESHNESS_MS) reasons.push('QUOTE_OLDER_THAN_FROZEN_CONTRACT');
    if (eventAgeMs === null) reasons.push('EVENT_AGE_UNAVAILABLE');
    else if (eventAgeMs > FROZEN_FRESHNESS_MS) reasons.push('EVENT_OLDER_THAN_FROZEN_CONTRACT');

    return Object.freeze({
      symbol,
      available: Boolean(row),
      source: row?.source ?? null,
      price,
      timestamp: Number.isFinite(timestampMs) ? new Date(timestampMs).toISOString() : null,
      marketState: row?.marketState ?? null,
      stale: row?.stale ?? null,
      quoteAgeSeconds: finite(row?.quoteAgeSeconds) ? Number(row.quoteAgeSeconds) : null,
      eventAgeMs,
      approved: reasons.length === 0,
      reasons: Object.freeze(reasons)
    });
  });

  const approved = assets.every((item) => item.approved);
  return Object.freeze({
    version: 'biquote-forex-bounded-commission-v2',
    provider: 'BIQUOTE',
    mode: 'READ_ONLY_BOUNDED_QUALIFICATION',
    freshnessContractMs: FROZEN_FRESHNESS_MS,
    requestedSymbols: SYMBOLS,
    assets: Object.freeze(assets),
    approved,
    qualification: approved ? 'APPROVED_FOR_CONTINUOUS_RUNTIME_TRIAL' : 'BLOCKED',
    decisionImpact: 'NONE',
    automatedBrokerExecution: false,
    ordersExecuted: 0
  });
}

export async function runBiquoteForexCommission({ fetchImpl = fetch, now = Date.now } = {}) {
  const params = new URLSearchParams();
  for (const symbol of SYMBOLS) params.append('symbols', symbol);
  const url = `${BASE_URL}/api/latest?${params}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let requestsMade = 0;
  const startedAt = Date.now();

  try {
    requestsMade += 1;
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) {
      return {
        version: 'biquote-forex-bounded-commission-v2',
        provider: 'BIQUOTE',
        mode: 'READ_ONLY_BOUNDED_QUALIFICATION',
        requestBudget: 1,
        requestsMade,
        status: 'BLOCKED',
        providerStatus: response.status,
        failure: 'BIQUOTE_HTTP_ERROR',
        decisionImpact: 'NONE',
        ordersExecuted: 0,
        durationMs: Date.now() - startedAt
      };
    }
    const payload = await response.json();
    const assessment = assessBiquoteForexCommission(payload, { now: now() });
    return {
      ...assessment,
      requestBudget: 1,
      requestsMade,
      status: assessment.approved ? 'APPROVED' : 'BLOCKED',
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      version: 'biquote-forex-bounded-commission-v2',
      provider: 'BIQUOTE',
      mode: 'READ_ONLY_BOUNDED_QUALIFICATION',
      requestBudget: 1,
      requestsMade,
      status: 'BLOCKED',
      failure: error?.name === 'AbortError' ? 'BIQUOTE_TIMEOUT' : 'BIQUOTE_REQUEST_FAILED',
      providerName: error?.name ?? null,
      decisionImpact: 'NONE',
      ordersExecuted: 0,
      durationMs: Date.now() - startedAt
    };
  } finally {
    clearTimeout(timeout);
  }
}

const isMain = Boolean(process.argv[1])
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const result = await runBiquoteForexCommission();
  console.log(JSON.stringify(result, null, 2));
}
