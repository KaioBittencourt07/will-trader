import { Router } from 'express';
import { createTwelveDataProvider } from '../../../data/src/providers/twelveDataProvider.js';
import { createMarketDataEngine } from '../../../data/src/marketDataEngine.js';
import { buildMultiTimeframeContext } from '../../../context/src/multiTimeframe.js';
import { classifyTwelveDataFailure, diagnoseTwelveData, TWELVE_DATA_DIAGNOSTIC_VERSION } from '../../../data/src/providers/twelveDataDiagnostics.js';

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

export async function getLocalRelaySnapshot(asset, timeframe = '1min', outputsize = 50) {
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
  const baseUrl = (process.env.WILL_LOCAL_MARKET_RELAY || 'http://127.0.0.1:3000').replace(/\/$/, '');
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

router.get('/market', async (req, res) => {
  const asset = String(req.query.asset || process.env.DEFAULT_ASSET || 'EUR/USD');
  const timeframe = String(req.query.timeframe || '1min');
  const outputsize = Math.min(Math.max(Number(req.query.outputsize || 50), 12), 200);
  try {
    const snapshot = await getMarketDataEngine().getSnapshot(asset, timeframe, outputsize);
    return res.json({ ok: snapshot.valid, snapshot });
  } catch (error) {
    console.error('Market provider error:', error.message);
    return res.status(503).json({ ok: false, error: error.message });
  }
});

router.get('/market/status', (_req, res) => {
  return res.json({
    ok: true,
    direct: getMarketDataEngine().getMetrics(),
    relay: getLocalRelayStatus()
  });
});

// Diagnostic only: it shares the existing cache/rate limiter and cannot start
// collection, create a decision, or reach any broker execution surface.
router.get('/market/diagnostic', async (req, res) => {
  const asset = String(req.query.asset || process.env.DEFAULT_ASSET || 'EUR/USD');
  const timeframe = String(req.query.timeframe || '1min');
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
    return res.status(503).json({ ok: false, diagnostic });
  }
  const diagnostic = await diagnoseTwelveData({ engine, asset, timeframe });
  return res.status(diagnostic.ok ? 200 : 503).json({ ok: diagnostic.ok, diagnostic });
});

router.get('/market/multi', async (req, res) => {
  const asset = String(req.query.asset || process.env.DEFAULT_ASSET || 'EUR/USD');
  const timeframes = String(req.query.timeframes || '1min,5min,15min').split(',').map((value) => value.trim()).filter(Boolean).slice(0, 3);
  const outputsize = Math.min(Math.max(Number(req.query.outputsize || 50), 20), 200);
  try {
    const snapshots = [];
    for (const timeframe of timeframes) snapshots.push(await getMarketDataEngine().getSnapshot(asset, timeframe, outputsize));
    const context = buildMultiTimeframeContext(snapshots);
    return res.json({ ok: snapshots.every((snapshot) => snapshot.valid), snapshots, context });
  } catch (error) {
    console.error('Multi-timeframe provider error:', error.message);
    return res.status(503).json({ ok: false, error: error.message });
  }
});

export default router;

