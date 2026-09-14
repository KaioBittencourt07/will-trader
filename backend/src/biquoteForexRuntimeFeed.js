import { assessBiquoteForexCommission } from './commissionBiquoteForexReadOnly.js';
import { qualifyTemporalAuthorityObservation } from './temporalAuthorityProvider.js';

export const BIQUOTE_FOREX_RUNTIME_VERSION = 'biquote-forex-runtime-feed-v1';
export const BIQUOTE_FOREX_PRODUCTS = Object.freeze({
  'EUR/USD': 'EURUSD',
  'GBP/USD': 'GBPUSD',
  'USD/JPY': 'USDJPY',
  'USD/CHF': 'USDCHF',
  'AUD/USD': 'AUDUSD',
  'NZD/USD': 'NZDUSD',
  'USD/CAD': 'USDCAD',
  'GBP/JPY': 'GBPJPY'
});

const BASE_URL = 'https://biquote.io';
const FROZEN_FRESHNESS_MS = 30_000;

function clamp(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function buildUrl() {
  const params = new URLSearchParams();
  for (const symbol of Object.values(BIQUOTE_FOREX_PRODUCTS)) params.append('symbols', symbol);
  return `${BASE_URL}/api/latest?${params}`;
}

function freshnessOnlyReason(reason) {
  return reason === 'QUOTE_OLDER_THAN_FROZEN_CONTRACT' || reason === 'EVENT_OLDER_THAN_FROZEN_CONTRACT';
}

export function createBiquoteForexRuntimeFeed({
  enabled = false,
  fetchImpl = fetch,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  pollIntervalMs = 10_000,
  requestTimeoutMs = 8_000
} = {}) {
  const intervalMs = clamp(pollIntervalMs, 5_000, 30_000, 10_000);
  const timeoutMs = clamp(requestTimeoutMs, 2_000, 15_000, 8_000);
  const url = buildUrl();
  let running = false;
  let timer = null;
  let inFlight = false;
  let state = enabled ? 'IDLE' : 'DISABLED';
  let payload = null;
  let receivedAt = null;
  let requestsMade = 0;
  let successfulPolls = 0;
  let failedPolls = 0;
  let skippedOverlaps = 0;
  let lastError = null;
  let lastHttpStatus = null;

  function schedule() {
    if (!running || timer) return;
    timer = setTimer(async () => {
      timer = null;
      await pollOnce();
      schedule();
    }, intervalMs);
  }

  async function pollOnce() {
    if (!enabled) return false;
    if (inFlight) {
      skippedOverlaps += 1;
      return false;
    }

    inFlight = true;
    state = 'POLLING';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      requestsMade += 1;
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal
      });
      lastHttpStatus = response.status;
      if (!response.ok) throw new Error(`BIQUOTE_HTTP_${response.status}`);
      const nextPayload = await response.json();
      const assessment = assessBiquoteForexCommission(nextPayload, { now: now() });
      payload = nextPayload;
      receivedAt = new Date(now()).toISOString();
      successfulPolls += 1;
      lastError = null;
      state = assessment.assets.some((asset) => asset.approved) ? 'CONNECTED' : 'DEGRADED';
      return true;
    } catch (error) {
      failedPolls += 1;
      lastError = error?.name === 'AbortError'
        ? 'BIQUOTE_RUNTIME_TIMEOUT'
        : String(error?.message || 'BIQUOTE_RUNTIME_REQUEST_FAILED').slice(0, 200);
      state = payload ? 'DEGRADED' : 'ERROR';
      return false;
    } finally {
      clearTimeout(timeout);
      inFlight = false;
    }
  }

  function getAssetHealth(asset) {
    const canonical = String(asset || '').trim().toUpperCase();
    const providerSymbol = BIQUOTE_FOREX_PRODUCTS[canonical];
    if (!providerSymbol) return null;
    if (!payload || !receivedAt) {
      return Object.freeze({
        version: BIQUOTE_FOREX_RUNTIME_VERSION,
        enabled,
        running,
        state,
        asset: canonical,
        providerSymbol,
        ready: false,
        latestTick: null,
        temporalAuthority: null,
        reasons: Object.freeze(['BIQUOTE_RUNTIME_NO_CACHED_TICK']),
        decisionImpact: 'NONE',
        ordersExecuted: 0
      });
    }

    const assessment = assessBiquoteForexCommission(payload, { now: now() });
    const tick = assessment.assets.find((item) => item.symbol === providerSymbol) ?? null;
    const structuralReasons = tick?.reasons?.filter((reason) => !freshnessOnlyReason(reason)) ?? ['SYMBOL_MISSING'];
    if (!tick?.source) structuralReasons.push('SOURCE_MISSING');
    const semanticApproved = structuralReasons.length === 0;
    const eventTimestamp = Number.isFinite(Date.parse(tick?.timestamp ?? '')) ? Date.parse(tick.timestamp) : null;
    const authority = qualifyTemporalAuthorityObservation({
      provider: 'biquote-forex',
      symbol: canonical,
      eventTimestamp,
      receivedAt,
      timestampAuthority: semanticApproved ? 'BIQUOTE_API_LATEST_TICK_TIMESTAMP' : 'UNRESOLVED',
      provenanceVerified: semanticApproved,
      perEventSemanticsVerified: semanticApproved,
      now: now(),
      maxAgeMs: FROZEN_FRESHNESS_MS
    });

    const providerFresh = tick?.approved === true;
    const ready = providerFresh && authority.authorityGate === 'PASS' && authority.freshnessGate === 'PASS';
    const reasons = [...new Set([...(tick?.reasons ?? []), ...authority.reasons, ...structuralReasons])];

    return Object.freeze({
      version: BIQUOTE_FOREX_RUNTIME_VERSION,
      mode: 'TEMPORAL_AUTHORITY_ONLY',
      enabled,
      running,
      state,
      asset: canonical,
      providerSymbol,
      pollIntervalMs: intervalMs,
      requestTimeoutMs: timeoutMs,
      ready,
      latestTick: tick ? Object.freeze({
        symbol: canonical,
        providerSymbol,
        price: tick.price,
        eventTimestamp,
        eventTimeRaw: tick.timestamp,
        receivedAt,
        source: tick.source,
        marketState: tick.marketState,
        stale: tick.stale,
        quoteAgeSeconds: tick.quoteAgeSeconds,
        eventAgeMs: tick.eventAgeMs
      }) : null,
      qualification: assessment.qualification,
      temporalAuthority: authority,
      reasons: Object.freeze(reasons),
      decisionImpact: ready ? 'ALLOW_ANALYSIS_ONLY' : 'NONE',
      ordersExecuted: 0
    });
  }

  function health() {
    const assets = Object.fromEntries(Object.keys(BIQUOTE_FOREX_PRODUCTS).map((asset) => {
      const item = getAssetHealth(asset);
      return [asset, {
        ready: item?.ready === true,
        providerSymbol: item?.providerSymbol ?? null,
        lastTickAt: item?.latestTick?.eventTimeRaw ?? null,
        source: item?.latestTick?.source ?? null,
        marketState: item?.latestTick?.marketState ?? null,
        stale: item?.latestTick?.stale ?? null,
        quoteAgeSeconds: item?.latestTick?.quoteAgeSeconds ?? null,
        reasons: item?.reasons ?? []
      }];
    }));
    return Object.freeze({
      version: BIQUOTE_FOREX_RUNTIME_VERSION,
      mode: 'READ_ONLY_CONTINUOUS_CACHED_POLLING',
      enabled,
      running,
      state,
      endpoint: url,
      authenticationRequired: false,
      pollIntervalMs: intervalMs,
      requestTimeoutMs: timeoutMs,
      requestsMade,
      successfulPolls,
      failedPolls,
      skippedOverlaps,
      lastHttpStatus,
      lastError,
      lastReceivedAt: receivedAt,
      cached: Boolean(payload),
      assets,
      automatedBrokerExecution: false,
      ordersExecuted: 0
    });
  }

  function start() {
    if (!enabled || running) return false;
    running = true;
    state = 'STARTING';
    void pollOnce().finally(schedule);
    return true;
  }

  function stop() {
    running = false;
    if (timer) clearTimer(timer);
    timer = null;
    state = enabled ? 'STOPPED' : 'DISABLED';
  }

  return Object.freeze({ start, stop, pollOnce, health, getAssetHealth });
}
