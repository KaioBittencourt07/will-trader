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

export function parseMarketOutputsize(raw, minimum = 12) {
  if (raw === undefined || raw === null) return { value: 50 };
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) return { error: 'MARKET_OUTPUTSIZE_INVALID' };
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) return { error: 'MARKET_OUTPUTSIZE_INVALID' };
  return { value: Math.min(Math.max(parsed, minimum), 200) };
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
  const parsedOutputsize = parseMarketOutputsize(req.query.outputsize, 12);
  if (parsedOutputsize.error) return res.status(400).json({ ok: false, error: parsedOutputsize.error });
  const outputsize = parsedOutputsize.value;
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
  const parsedOutputsize = parseMarketOutputsize(req.query.outputsize, 20);
  if (parsedOutputsize.error) return res.status(400).json({ ok: false, error: parsedOutputsize.error });
  const outputsize = parsedOutputsize.value;
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
