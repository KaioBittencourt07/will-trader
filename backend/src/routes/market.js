import { Router } from 'express';
import { createTwelveDataProvider } from '../../../data/src/providers/twelveDataProvider.js';
import { createMarketDataEngine } from '../../../data/src/marketDataEngine.js';
import { buildMultiTimeframeContext } from '../../../context/src/multiTimeframe.js';
import { classifyTwelveDataFailure, diagnoseTwelveData, TWELVE_DATA_DIAGNOSTIC_VERSION } from '../../../data/src/providers/twelveDataDiagnostics.js';
import { createProviderEfficiencyTelemetry, providerEfficiencySnapshot } from '../../../data/src/providerEfficiency.js';
import { composeWsFreshnessRestOhlc } from '../../../data/src/wsRestComposition.js';
import { attachMarketAuthoritativeFreshness } from '../marketAuthoritativeFreshness.js';
import { buildLocalRelayHeaders } from '../localRelayAuth.js';
import { attestMarketSnapshot } from '../marketSnapshotAttestation.js';

const router = Router();
let marketDataEngine;
const relayCache = new Map();
let nextRelayRequestAt = 0;
let relayLastSuccessAt = null;
let relayLastError = null;
let relayLastAsset = null;

export function getLocalRelayStatus(now = Date.now()) {
  const cooldownMs = Math.max(0, nextRelayRequestAt - now);
  return {
    mode: relayLastSuccessAt ? 'LOCAL_RELAY' : 'DIRECT_OR_IDLE',
    cacheEntries: relayCache.size,
    cooldownMs,
    coolingDown: cooldownMs > 0,
    lastSuccessAt: relayLastSuccessAt,
    lastAsset: relayLastAsset,
    lastError: relayLastError
  };
}

export async function getLocalRelaySnapshot(asset, timeframe = '1min', outputsize = 50, { telemetry } = {}) {
  const key = `${String(asset).toUpperCase()}|${timeframe}|${outputsize}`;
  const now = Date.now();
  const cached = relayCache.get(key);
  if (cached && now - cached.storedAt < 30_000) {
    relayLastAsset = asset;
    return cached.snapshot;
  }
  if (now < nextRelayRequestAt) {
    const seconds = Math.ceil((nextRelayRequestAt - now) / 1_000);
    const message = `Relay local em cooldown (${seconds}s) para respeitar o limite do feed.`;
    relayLastError = message;
    throw new Error(message);
  }
  const baseUrl = (process.env.WILL_LOCAL_MARKET_RELAY || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/$/, '');
  const query = new URLSearchParams({ asset, timeframe, outputsize: String(outputsize) });
  let response;
  try {
    response = await fetch(`${baseUrl}/api/market?${query}`, { headers: buildLocalRelayHeaders({ relayUrl: baseUrl }), signal: AbortSignal.timeout(12_000) });
  } catch (error) {
    const message = `Relay local indisponível: ${error?.cause?.code || error.message}`;
    relayLastError = message;
    throw new Error(message);
  }
  const body = await response.json().catch(() => null);
  if (body?.providerEfficiency && telemetry) {
    for (const key of ['externalRequests', 'cacheHits', 'cacheMisses', 'deduplicated', 'blockedByCooldown', 'rateLimitEvents', 'limiterWaitMs', 'externalLatencyMs', 'creditsEstimated']) {
      const value = Number(body.providerEfficiency[key]);
      if (Number.isFinite(value) && value >= 0) telemetry[key] += value;
    }
  }
  if (!response.ok || !body?.snapshot) {
    nextRelayRequestAt = Date.now() + (response.status === 429 ? 60_000 : 15_000);
    const message = body?.error || `Relay local HTTP ${response.status}`;
    relayLastError = message;
    throw new Error(message);
  }
  nextRelayRequestAt = Date.now() + 16_000;
  relayCache.set(key, { snapshot: body.snapshot, storedAt: Date.now() });
  relayLastSuccessAt = new Date().toISOString();
  relayLastAsset = asset;
  relayLastError = null;
  return body.snapshot;
}

export function getMarketDataEngine() {
  if (!marketDataEngine) {
    marketDataEngine = createMarketDataEngine({
      provider: createTwelveDataProvider()
    });
  }
  return marketDataEngine;
}

function withServerAttestation(snapshot) {
  const attestation = attestMarketSnapshot(snapshot);
  return Object.freeze({
    ...snapshot,
    snapshotAttestationId: attestation.id,
    snapshotAttestationVersion: attestation.version,
    snapshotAttestationExpiresAt: attestation.expiresAt
  });
}

router.get('/market', async (req, res) => {
  const asset = String(req.query.asset || process.env.DEFAULT_ASSET || 'EUR/USD');
  const timeframe = String(req.query.timeframe || '1min');
  const outputsize = Math.min(Math.max(Number(req.query.outputsize || 50), 12), 200);
  const telemetry = createProviderEfficiencyTelemetry('api-market-request');
  try {
    const rawSnapshot = await getMarketDataEngine().getSnapshot(asset, timeframe, outputsize, { telemetry });
    const snapshot = withServerAttestation(attachMarketAuthoritativeFreshness(rawSnapshot));
    return res.json({ ok: snapshot.valid, snapshot, providerEfficiency: providerEfficiencySnapshot(telemetry) });
  } catch (error) {
    console.error('Market provider error:', error.message);
    return res.status(503).json({ ok: false, error: error.message, providerEfficiency: providerEfficiencySnapshot(telemetry) });
  }
});

router.get('/market/status', (req, res) => {
  const webSocketShadow = req.app.locals.twelveWebSocketFeed?.health?.() ?? {
    mode: 'SHADOW_OBSERVABILITY', state: 'UNAVAILABLE', enabled: false, decisionImpact: 'NONE'
  };
  const relay = getLocalRelayStatus();

  try {
    const engine = getMarketDataEngine();
    return res.json({
      ok: true,
      direct: engine.getMetrics(),
      providerReadiness: engine.getProviderReadiness(),
      relay,
      webSocketShadow
    });
  } catch (error) {
    // Status must remain inspectable even when external market data is not configured.
    // This does not make market data available or allow a signal to bypass Data Guard.
    if (String(error?.message || '') === 'TWELVEDATA_API_KEY não configurada.') {
      return res.json({
        ok: true,
        direct: { provider: 'twelvedata', state: 'UNCONFIGURED' },
        providerReadiness: {
          provider: 'twelvedata',
          ready: false,
          state: 'UNCONFIGURED',
          reasonCode: 'TWELVEDATA_API_KEY_NOT_CONFIGURED'
        },
        relay,
        webSocketShadow
      });
    }
    return res.status(503).json({
      ok: false,
      error: 'MARKET_STATUS_UNAVAILABLE',
      relay,
      webSocketShadow
    });
  }
});

function ageMsFrom(timestamp, now = Date.now()) {
  const parsed = Date.parse(timestamp ?? '');
  return Number.isFinite(parsed) ? Math.max(0, now - parsed) : null;
}

function getRestSourceObservation(now = Date.now()) {
  const configured = Boolean(String(process.env.TWELVEDATA_API_KEY ?? '').trim());
  if (!configured) {
    return {
      id: 'twelvedata-rest',
      provider: 'twelvedata',
      transport: 'REST',
      role: 'QUOTE_AND_OHLC',
      state: 'UNCONFIGURED',
      configured: false,
      probePerformed: false,
      lastSuccessAt: null,
      lastSuccessAgeMs: null,
      upstreamRequestsObserved: 0
    };
  }

  try {
    const metrics = getMarketDataEngine().getMetrics();
    const lastSuccessAt = metrics.lastSuccessAt ?? null;
    const lastSuccessAgeMs = ageMsFrom(lastSuccessAt, now);
    const probePerformed = Number(metrics.upstreamRequests ?? 0) > 0;
    let state = 'CONFIGURED_NOT_PROBED';

    if (probePerformed) {
      if (['DEGRADED', 'OFFLINE', 'MISCONFIGURED', 'RATE_LIMITED', 'COOLDOWN'].includes(metrics.providerState)) {
        state = metrics.providerState;
      } else if (lastSuccessAt && lastSuccessAgeMs !== null && lastSuccessAgeMs <= 30_000) {
        state = 'OBSERVED_RECENT_SUCCESS';
      } else if (lastSuccessAt) {
        state = 'OBSERVED_STALE_SUCCESS';
      } else {
        state = 'PROBE_FAILED';
      }
    }

    return {
      id: 'twelvedata-rest',
      provider: 'twelvedata',
      transport: 'REST',
      role: 'QUOTE_AND_OHLC',
      state,
      configured: true,
      probePerformed,
      lastSuccessAt,
      lastSuccessAgeMs,
      upstreamRequestsObserved: Number(metrics.upstreamRequests ?? 0),
      providerState: metrics.providerState ?? 'UNKNOWN',
      lastErrorAt: metrics.lastErrorAt ?? null
    };
  } catch {
    return {
      id: 'twelvedata-rest',
      provider: 'twelvedata',
      transport: 'REST',
      role: 'QUOTE_AND_OHLC',
      state: 'CONFIGURED_BUT_UNAVAILABLE',
      configured: true,
      probePerformed: false,
      lastSuccessAt: null,
      lastSuccessAgeMs: null,
      upstreamRequestsObserved: 0
    };
  }
}

function getTwelveWebSocketSource(feed, now = Date.now()) {
  let health = null;
  try {
    health = feed?.health?.() ?? null;
  } catch {
    health = null;
  }
  if (!health) {
    return {
      id: 'twelvedata-websocket',
      provider: 'twelvedata',
      transport: 'WEBSOCKET',
      role: 'SHADOW_OBSERVABILITY',
      state: 'UNAVAILABLE',
      enabled: false,
      connected: false,
      available: false,
      freshSymbols: 0,
      configuredSymbols: 0,
      probePerformed: false
    };
  }

  const symbols = Array.isArray(health.symbols) ? health.symbols : [];
  const freshSymbols = symbols.filter((symbol) => symbol.fresh === true).length;
  let state = 'DISABLED';
  if (health.enabled === true) {
    if (health.connected === true && health.available === true) state = 'CONNECTED_WITH_FRESH_TICKS';
    else if (health.connected === true) state = 'CONNECTED_WITHOUT_FRESH_TICKS';
    else if (Number(health.successfulConnections ?? 0) > 0) state = 'DISCONNECTED_AFTER_CONNECTION';
    else state = 'ENABLED_NOT_CONNECTED';
  }

  return {
    id: 'twelvedata-websocket',
    provider: 'twelvedata',
    transport: 'WEBSOCKET',
    role: health.mode ?? 'SHADOW_OBSERVABILITY',
    state,
    enabled: health.enabled === true,
    connected: health.connected === true,
    available: health.available === true,
    freshSymbols,
    configuredSymbols: Number(health.configuredSymbols ?? symbols.length),
    lastTickAgeMs: health.lastTickAgeMs ?? null,
    successfulConnections: Number(health.successfulConnections ?? 0),
    probePerformed: Number(health.successfulConnections ?? 0) > 0
      || Number(health.messagesReceived ?? 0) > 0,
    checkedAt: new Date(now).toISOString()
  };
}

function getCoinbaseTemporalSources(feeds, now = Date.now()) {
  if (!(feeds instanceof Map) || feeds.size === 0) {
    return [{
      id: 'coinbase-temporal',
      provider: 'coinbase',
      transport: 'WEBSOCKET',
      role: 'TEMPORAL_AUTHORITY_ONLY',
      state: 'IMPLEMENTED_NOT_PROBED',
      enabled: false,
      running: false,
      connected: false,
      ready: false,
      probePerformed: false,
      decisionImpact: 'NONE',
      ordersExecuted: 0
    }];
  }

  return [...feeds.entries()].map(([symbol, feed]) => {
    let health = null;
    try {
      health = feed?.health?.() ?? null;
    } catch {
      health = null;
    }

    if (!health) {
      return {
        id: `coinbase-temporal:${symbol}`,
        provider: 'coinbase',
        symbol,
        transport: 'WEBSOCKET',
        role: 'TEMPORAL_AUTHORITY_ONLY',
        state: 'UNAVAILABLE',
        enabled: false,
        running: false,
        connected: false,
        ready: false,
        probePerformed: false,
        decisionImpact: 'NONE',
        ordersExecuted: 0
      };
    }

    const connected = health.state === 'CONNECTED';
    const probePerformed = Number(health.messagesReceived ?? 0) > 0
      || Number(health.acceptedObservations ?? 0) > 0
      || Number(health.reconnects ?? 0) > 0;
    let state = health.state ?? 'UNKNOWN';
    if (health.enabled !== true) state = 'DISABLED';
    else if (connected && health.ready === true) state = 'OBSERVED_QUALIFIED';
    else if (connected) state = 'CONNECTED_NOT_QUALIFIED';
    else if (!probePerformed) state = 'IMPLEMENTED_NOT_PROBED';

    return {
      id: `coinbase-temporal:${symbol}`,
      provider: 'coinbase',
      symbol,
      transport: 'WEBSOCKET',
      role: health.mode ?? 'TEMPORAL_AUTHORITY_ONLY',
      state,
      enabled: health.enabled === true,
      running: health.running === true,
      connected,
      ready: health.ready === true,
      probePerformed,
      lastTickAt: health.latestTick?.eventTimeRaw ?? null,
      lastTickReceivedAt: health.latestTick?.receivedAt ?? null,
      lastTickAgeMs: ageMsFrom(health.latestTick?.receivedAt, now),
      messagesReceived: Number(health.messagesReceived ?? 0),
      decisionImpact: health.decisionImpact ?? 'NONE',
      ordersExecuted: Number(health.ordersExecuted ?? 0)
    };
  });
}

router.get('/market/sources', (req, res) => {
  const now = Date.now();
  let biquoteHealth = null;
  try {
    biquoteHealth = req.app.locals.biquoteForexFeed?.health?.() ?? null;
  } catch {
    biquoteHealth = null;
  }

  const biquote = biquoteHealth ? {
    id: 'biquote-forex',
    provider: 'biquote-forex',
    transport: 'POLLING',
    role: biquoteHealth.mode ?? 'READ_ONLY_CONTINUOUS_CACHED_POLLING',
    state: biquoteHealth.state ?? 'UNKNOWN',
    enabled: biquoteHealth.enabled === true,
    running: biquoteHealth.running === true,
    probePerformed: Number(biquoteHealth.requestsMade ?? 0) > 0,
    requestsObserved: Number(biquoteHealth.requestsMade ?? 0),
    successfulPolls: Number(biquoteHealth.successfulPolls ?? 0),
    failedPolls: Number(biquoteHealth.failedPolls ?? 0),
    lastReceivedAt: biquoteHealth.lastReceivedAt ?? null,
    lastHttpStatus: biquoteHealth.lastHttpStatus ?? null,
    readyAssets: Object.values(biquoteHealth.assets ?? {}).filter((asset) => asset?.ready === true).length,
    configuredAssets: Object.keys(biquoteHealth.assets ?? {}).length,
    automatedBrokerExecution: false,
    ordersExecuted: 0
  } : {
    id: 'biquote-forex',
    provider: 'biquote-forex',
    transport: 'POLLING',
    role: 'READ_ONLY_CONTINUOUS_CACHED_POLLING',
    state: 'UNAVAILABLE',
    enabled: false,
    running: false,
    probePerformed: false,
    automatedBrokerExecution: false,
    ordersExecuted: 0
  };

  return res.json({
    ok: true,
    checkedAt: new Date(now).toISOString(),
    mode: 'READ_ONLY_STATUS_NO_UPSTREAM_PROBES',
    note: 'Este endpoint resume estado observado; não inicia conexões nem solicita cotações externas.',
    sources: [
      getRestSourceObservation(now),
      getTwelveWebSocketSource(req.app.locals.twelveWebSocketFeed, now),
      ...getCoinbaseTemporalSources(req.app.locals.coinbaseTemporalFeeds, now),
      biquote,
      {
        id: 'binance',
        provider: 'binance',
        transport: 'UNVERIFIED',
        role: 'MARKET_DATA',
        state: 'IMPLEMENTED_NOT_PROBED',
        enabled: false,
        connected: false,
        probePerformed: false,
        decisionImpact: 'NONE',
        ordersExecuted: 0
      },
      {
        id: 'avalon',
        provider: 'avalon',
        transport: 'UNVERIFIED',
        role: 'BROKER_FEED',
        state: 'NOT_CONNECTED',
        enabled: false,
        connected: false,
        probePerformed: false,
        decisionImpact: 'NONE',
        ordersExecuted: 0
      }
    ]
  });
});

router.get('/market/diagnostic', async (req, res) => {
  const asset = String(req.query.asset || process.env.DEFAULT_ASSET || 'EUR/USD');
  const timeframe = String(req.query.timeframe || '1min');
  const telemetry = createProviderEfficiencyTelemetry('api-market-diagnostic-request');
  let engine;
  try {
    engine = getMarketDataEngine();
  } catch (error) {
    const diagnostic = {
      ok: false,
      status: classifyTwelveDataFailure(error),
      checkedAt: new Date().toISOString(),
      version: TWELVE_DATA_DIAGNOSTIC_VERSION,
      detail: String(error?.message ?? 'MARKET_ENGINE_UNAVAILABLE').slice(0, 500)
    };
    return res.status(503).json({ ok: false, diagnostic, providerEfficiency: providerEfficiencySnapshot(telemetry) });
  }
  const diagnostic = await diagnoseTwelveData({
    engine,
    asset,
    timeframe,
    telemetry,
    composeShadow: (snapshot) => composeWsFreshnessRestOhlc({
      restSnapshot: snapshot,
      wsHealth: req.app.locals.twelveWebSocketFeed?.health?.(),
      canonicalSymbol: asset,
      timeframe
    })
  });
  return res.status(diagnostic.ok ? 200 : 503).json({ ok: diagnostic.ok, diagnostic, providerEfficiency: providerEfficiencySnapshot(telemetry) });
});

router.get('/market/multi', async (req, res) => {
  const asset = String(req.query.asset || process.env.DEFAULT_ASSET || 'EUR/USD');
  const timeframes = String(req.query.timeframes || '1min,5min,15min').split(',').map((value) => value.trim()).filter(Boolean).slice(0, 3);
  const outputsize = Math.min(Math.max(Number(req.query.outputsize || 50), 20), 200);
  try {
    const snapshots = [];
    for (const timeframe of timeframes) {
      const rawSnapshot = await getMarketDataEngine().getSnapshot(asset, timeframe, outputsize);
      snapshots.push(withServerAttestation(attachMarketAuthoritativeFreshness(rawSnapshot)));
    }
    const context = buildMultiTimeframeContext(snapshots);
    return res.json({ ok: snapshots.every((snapshot) => snapshot.valid), snapshots, context });
  } catch (error) {
    console.error('Multi-timeframe provider error:', error.message);
    return res.status(503).json({ ok: false, error: error.message });
  }
});

export default router;
