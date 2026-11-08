import { Router } from 'express';
import { createTwelveDataProvider } from '../../../data/src/providers/twelveDataProvider.js';
import { createMarketDataEngine } from '../../../data/src/marketDataEngine.js';
import { buildMultiTimeframeContext } from '../../../context/src/multiTimeframe.js';
import { classifyTwelveDataFailure, diagnoseTwelveData, TWELVE_DATA_DIAGNOSTIC_VERSION } from '../../../data/src/providers/twelveDataDiagnostics.js';
import { createProviderEfficiencyTelemetry, providerEfficiencySnapshot } from '../../../data/src/providerEfficiency.js';
import { composeWsFreshnessRestOhlc } from '../../../data/src/wsRestComposition.js';
import { attachMarketAuthoritativeFreshness } from '../marketAuthoritativeFreshness.js';
import { attestMarketSnapshot } from '../marketSnapshotAttestation.js';

const router = Router();
let marketDataEngine;
const relayCache = new Map();
let nextRelayRequestAt = 0;
let relayLastSuccessAt = null;
let relayLastError = null;
let relayLastAsset = null;

export function resolveLocalRelayBaseUrl({ relayUrl = process.env.WILL_LOCAL_MARKET_RELAY, backendPort = process.env.PORT || 3000 } = {}) {
  const configured = String(relayUrl ?? '').trim();
  if (!configured) throw new Error('LOCAL_RELAY_NOT_CONFIGURED');
  let parsed;
  try { parsed = new URL(configured); } catch { throw new Error('LOCAL_RELAY_URL_INVALID'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('LOCAL_RELAY_URL_INVALID');
  }
  const host = parsed.hostname.toLowerCase().replace('[', '').replace(']', '');
  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  const currentBackendPort = Number(backendPort || 3000);
  const loopback = ['localhost', '127.0.0.1', '::1', '0.0.0.0', '::'].includes(host);
  if (loopback && port === currentBackendPort) throw new Error('LOCAL_RELAY_SELF_REFERENCE');
  let baseUrl = parsed.toString();
  while (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
  return baseUrl;
}

export function isLocalRelayFallbackEligible(error, { configured = Boolean(String(process.env.WILL_LOCAL_MARKET_RELAY ?? '').trim()) } = {}) {
  if (!configured) return false;
  return Number(error?.status) === 429 || error?.code === 'PROVIDER_COOLDOWN'
    || /EACCES|network error|LOCAL_RELAY_REQUIRED/i.test(String(error?.message ?? error));
}

export function getLocalRelayStatus(now = Date.now()) {
  const cooldownMs = Math.max(0, nextRelayRequestAt - now);
  return {
    configured: Boolean(String(process.env.WILL_LOCAL_MARKET_RELAY ?? '').trim()),
    mode: relayLastSuccessAt ? 'LOCAL_RELAY' : String(process.env.WILL_LOCAL_MARKET_RELAY ?? '').trim() ? 'LOCAL_RELAY_CONFIGURED' : 'DIRECT_OR_IDLE',
    cacheEntries: relayCache.size,
    cooldownMs,
    coolingDown: cooldownMs > 0,
    lastSuccessAt: relayLastSuccessAt,
    lastAsset: relayLastAsset,
    lastError: relayLastError
  };
}

export async function getLocalRelaySnapshot(asset, timeframe = '1min', outputsize = 50, { telemetry } = {}) {
  const baseUrl = resolveLocalRelayBaseUrl();
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
  const query = new URLSearchParams({ asset, timeframe, outputsize: String(outputsize) });
  let response;
  try {
    response = await fetch(`${baseUrl}/api/market?${query}`, { signal: AbortSignal.timeout(12_000) });
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
  return res.json({
    ok: true,
    direct: getMarketDataEngine().getMetrics(),
    providerReadiness: getMarketDataEngine().getProviderReadiness(),
    relay: getLocalRelayStatus(),
    webSocketShadow: req.app.locals.twelveWebSocketFeed?.health?.() ?? {
      mode: 'SHADOW_OBSERVABILITY', state: 'UNAVAILABLE', enabled: false, decisionImpact: 'NONE'
    }
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
