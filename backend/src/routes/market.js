import { Router } from 'express';
import { createTwelveDataProvider } from '../../../data/src/providers/twelveDataProvider.js';
import {
  createCoinbaseExchangePublicProvider,
  COINBASE_PUBLIC_SPOT_PRODUCTS,
  coinbasePublicProductFor
} from '../../../data/src/providers/coinbaseExchangePublicProvider.js';
import {
  createBinanceSpotPublicProvider,
  BINANCE_PUBLIC_SPOT_SYMBOLS,
  binancePublicSymbolFor
} from '../../../data/src/providers/binanceSpotPublicProvider.js';
import { fetchFrankfurterDailyReference } from '../fxReferenceRate.js';
import { hasConfiguredValue } from '../configuredValue.js';
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
let coinbasePublicMarketEngine;
let binancePublicMarketEngine;

function createPublicSourceState() {
  return {
    attempts: 0,
    successes: 0,
    failures: 0,
    lastOutcome: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastErrorCode: null
  };
}

const publicSourceRuntime = new Map([
  ['coinbase-exchange-rest', createPublicSourceState()],
  ['binance-spot-rest', createPublicSourceState()]
]);

function recordPublicSourceOutcome(providerId, ok, error = null) {
  const state = publicSourceRuntime.get(providerId);
  if (!state) return;
  state.attempts += 1;
  if (ok) {
    state.successes += 1;
    state.lastOutcome = 'SUCCESS';
    state.lastSuccessAt = new Date().toISOString();
    state.lastErrorCode = null;
  } else {
    state.failures += 1;
    state.lastOutcome = 'FAILURE';
    state.lastFailureAt = new Date().toISOString();
    state.lastErrorCode = reasonCodeFor(error);
  }
}

function publicSourceRuntimeView(providerId) {
  const state = publicSourceRuntime.get(providerId) ?? createPublicSourceState();
  return Object.freeze({
    snapshotRequests: state.attempts,
    successfulSnapshots: state.successes,
    failedSnapshots: state.failures,
    lastOutcome: state.lastOutcome,
    lastSuccessAt: state.lastSuccessAt,
    lastFailureAt: state.lastFailureAt,
    lastErrorCode: state.lastErrorCode
  });
}

function publicSourceStatus(providerId) {
  const state = publicSourceRuntime.get(providerId);
  if (!state || state.attempts === 0) return 'IMPLEMENTED_NOT_PROBED';
  if (state.lastOutcome === 'FAILURE') return 'REQUEST_FAILED';
  if (state.lastOutcome === 'SUCCESS') return 'RESPONSE_OBSERVED';
  return 'IMPLEMENTED_NOT_PROBED';
}
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

function configuredTwelveDataKey() {
  const key = String(process.env.TWELVEDATA_API_KEY ?? '').trim();
  return hasConfiguredValue(key) ? key : null;
}

function boundedMarketMs(name, fallback, min = 500, max = 15_000) {
  const configured = Number(process.env[name]);
  if (!Number.isInteger(configured)) return fallback;
  return Math.min(max, Math.max(min, configured));
}

function createPublicCryptoEngine(provider) {
  return createMarketDataEngine({
    provider,
    cacheTtlMs: boundedMarketMs('MARKET_PUBLIC_CRYPTO_CACHE_TTL_MS', 3_000, 500, 15_000),
    minRequestIntervalMs: boundedMarketMs('MARKET_PUBLIC_CRYPTO_MIN_REQUEST_INTERVAL_MS', 1_000, 500, 15_000),
    maxRetries: 0
  });
}

function getCoinbasePublicMarketEngine() {
  if (!coinbasePublicMarketEngine) {
    coinbasePublicMarketEngine = createPublicCryptoEngine(createCoinbaseExchangePublicProvider());
  }
  return coinbasePublicMarketEngine;
}

function getBinancePublicMarketEngine() {
  if (!binancePublicMarketEngine) {
    binancePublicMarketEngine = createPublicCryptoEngine(createBinanceSpotPublicProvider());
  }
  return binancePublicMarketEngine;
}

export function getMarketDataEngine() {
  if (!marketDataEngine) {
    const apiKey = configuredTwelveDataKey();
    if (!apiKey) throw new Error('TWELVEDATA_API_KEY não configurada.');
    marketDataEngine = createMarketDataEngine({
      provider: createTwelveDataProvider({ apiKey })
    });
  }
  return marketDataEngine;
}

function reasonCodeFor(error) {
  if (Number(error?.status) === 429) return 'RATE_LIMITED';
  if (error?.code === 'COINBASE_PUBLIC_TIMEOUT' || error?.code === 'BINANCE_PUBLIC_TIMEOUT') return 'PROVIDER_TIMEOUT';
  if (error?.code === 'COINBASE_PUBLIC_UNAVAILABLE' || error?.code === 'BINANCE_PUBLIC_UNAVAILABLE') return 'PROVIDER_UNAVAILABLE';
  if (/STALE|FUTURE|INVALID|INSUFFICIENT|MALFORMED/i.test(String(error?.message ?? ''))) return 'DATA_QUALITY_REJECTED';
  return 'SOURCE_UNAVAILABLE';
}

function addProviderSelection(snapshot, { selectedProvider, requestedProvider = selectedProvider, fallback = false, priorFailure = null } = {}) {
  return Object.freeze({
    ...snapshot,
    providerSelection: Object.freeze({
      version: 'will-market-source-routing-v1',
      requestedProvider,
      selectedProvider,
      fallback,
      priorFailure: priorFailure ? Object.freeze({ provider: requestedProvider, reasonCode: priorFailure }) : null
    })
  });
}

export async function getMarketSnapshots(assets = [], timeframe = '1min', outputsize = 50, { telemetry } = {}) {
  const normalized = [...new Set((assets || []).map((asset) => String(asset ?? '').trim().toUpperCase()).filter(Boolean))];
  if (!normalized.length) return [];
  const results = new Map();
  const fallbackToTwelve = [];
  const publicAssets = normalized.filter((asset) => coinbasePublicProductFor(asset) || binancePublicSymbolFor(asset));
  const directTwelveAssets = normalized.filter((asset) => !coinbasePublicProductFor(asset) && !binancePublicSymbolFor(asset));

  // Each symbol has one explicitly selected venue. Public-provider failures are
  // not concealed: Twelve Data is only attempted as a separately labelled fallback.
  await Promise.all(publicAssets.map(async (asset) => {
    const isCoinbase = Boolean(coinbasePublicProductFor(asset));
    const providerId = isCoinbase ? 'coinbase-exchange-rest' : 'binance-spot-rest';
    const engine = isCoinbase ? getCoinbasePublicMarketEngine() : getBinancePublicMarketEngine();
    try {
      const snapshot = await engine.getSnapshot(asset, timeframe, outputsize, { telemetry });
      if (snapshot?.valid !== true || snapshot?.status !== 'OK') {
        throw new Error(`PUBLIC_SOURCE_SNAPSHOT_NOT_ADMISSIBLE:${snapshot?.reason || snapshot?.status || 'INVALID'}`);
      }
      results.set(asset, {
        asset,
        snapshot: addProviderSelection(snapshot, { selectedProvider: providerId }),
        error: null
      });
      recordPublicSourceOutcome(providerId, true);
    } catch (error) {
      recordPublicSourceOutcome(providerId, false, error);
      fallbackToTwelve.push({ asset, requestedProvider: providerId, reasonCode: reasonCodeFor(error), error });
    }
  }));

  const fallbackByAsset = new Map(fallbackToTwelve.map((entry) => [entry.asset, entry]));
  const twelveAssets = [...new Set([...directTwelveAssets, ...fallbackToTwelve.map((item) => item.asset)])];
  if (twelveAssets.length) {
    try {
      const entries = await getMarketDataEngine().getSnapshots(twelveAssets, timeframe, outputsize, { telemetry });
      for (const entry of entries) {
        const prior = fallbackByAsset.get(entry.asset);
        if (entry.snapshot?.valid === true && entry.snapshot?.status === 'OK') {
          results.set(entry.asset, {
            asset: entry.asset,
            snapshot: addProviderSelection(entry.snapshot, {
              selectedProvider: 'twelvedata',
              requestedProvider: prior?.requestedProvider || 'twelvedata',
              fallback: Boolean(prior),
              priorFailure: prior?.reasonCode || null
            }),
            error: null
          });
        } else {
          const reason = entry.error || entry.snapshot?.reason || entry.snapshot?.status || 'MARKET_SNAPSHOT_NOT_ADMISSIBLE';
          results.set(entry.asset, {
            asset: entry.asset,
            snapshot: null,
            error: prior
              ? `MARKET_SOURCES_UNAVAILABLE:${prior.requestedProvider}:${prior.reasonCode};TWELVEDATA:${String(reason).slice(0, 180)}`
              : String(reason).slice(0, 300)
          });
        }
      }
    } catch (error) {
      const message = !configuredTwelveDataKey()
        ? 'TWELVEDATA_API_KEY_NOT_CONFIGURED'
        : String(error?.message || 'TWELVEDATA_UNAVAILABLE').slice(0, 240);
      for (const asset of twelveAssets) {
        const prior = fallbackByAsset.get(asset);
        results.set(asset, {
          asset,
          snapshot: null,
          error: prior
            ? `MARKET_SOURCES_UNAVAILABLE:${prior.requestedProvider}:${prior.reasonCode};TWELVEDATA:${message}`
            : message
        });
      }
    }
  }

  return normalized.map((asset) => results.get(asset) ?? {
    asset,
    snapshot: null,
    error: 'MARKET_SOURCE_ROUTING_FAILED'
  });
}

export async function getMarketSnapshot(asset, timeframe = '1min', outputsize = 50, options = {}) {
  const entry = (await getMarketSnapshots([asset], timeframe, outputsize, options))[0];
  if (!entry || entry.error || !entry.snapshot) throw new Error(entry?.error || 'MARKET_SOURCE_ROUTING_FAILED');
  return entry.snapshot;
}

export function getMarketSourceCatalog(now = Date.now()) {
  const twelveConfigured = Boolean(configuredTwelveDataKey());
  return Object.freeze({
    version: 'will-market-source-catalog-v1',
    checkedAt: new Date(now).toISOString(),
    connectionChecksPerformed: false,
    activeProbePerformed: false,
    routingPolicy: 'EXACT_SYMBOL_MAPPING_THEN_SINGLE_PROVIDER_SNAPSHOT_FAIL_CLOSED',
    sources: Object.freeze([
      {
        id: 'coinbase-exchange-rest',
        name: 'Coinbase Exchange public REST',
        status: publicSourceStatus('coinbase-exchange-rest'),
        requiresApiKey: false,
        dataType: 'CRYPTO_SPOT_OHLC_AND_TICKER',
        quoteCurrency: 'USD',
        mappedAssets: Object.keys(COINBASE_PUBLIC_SPOT_PRODUCTS),
        runtimeObservation: publicSourceRuntimeView('coinbase-exchange-rest'),
        docsUrl: 'https://docs.cdp.coinbase.com/exchange',
        tradingExecution: false
      },
      {
        id: 'binance-spot-rest',
        name: 'Binance Spot public market-data REST',
        status: publicSourceStatus('binance-spot-rest'),
        requiresApiKey: false,
        dataType: 'CRYPTO_SPOT_OHLC_AND_TICKER',
        quoteCurrency: 'USDT',
        mappedAssets: Object.keys(BINANCE_PUBLIC_SPOT_SYMBOLS),
        runtimeObservation: publicSourceRuntimeView('binance-spot-rest'),
        docsUrl: 'https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md',
        tradingExecution: false
      },
      {
        id: 'twelvedata',
        name: 'Twelve Data',
        status: twelveConfigured ? 'CONFIGURED_NOT_PROBED' : 'UNCONFIGURED',
        requiresApiKey: true,
        dataType: 'MULTI_ASSET_MARKET_DATA',
        candidateAssetClasses: ['FOREX', 'STOCKS', 'ETFS', 'INDICES', 'COMMODITIES', 'CRYPTO'],
        docsUrl: 'https://twelvedata.com/docs',
        tradingExecution: false
      },
      {
        id: 'frankfurter-reference',
        name: 'Frankfurter daily FX reference rates',
        status: 'REFERENCE_ONLY_NOT_PROBED',
        requiresApiKey: false,
        dataType: 'DAILY_FX_REFERENCE',
        tradingEligible: false,
        docsUrl: 'https://frankfurter.dev/',
        tradingExecution: false
      },
      {
        id: 'avalon-traderoom',
        name: 'Avalon Traderoom',
        status: 'NOT_CONNECTED',
        reasonCode: 'NO_VERIFIED_MARKET_DATA_ADAPTER',
        dataType: 'NOT_AVAILABLE',
        tradingExecution: false,
        docsUrl: null
      }
    ])
  });
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
    const rawSnapshot = await getMarketSnapshot(asset, timeframe, outputsize, { telemetry });
    const snapshot = withServerAttestation(attachMarketAuthoritativeFreshness(rawSnapshot));
    return res.json({ ok: snapshot.valid, snapshot, providerEfficiency: providerEfficiencySnapshot(telemetry) });
  } catch (error) {
    console.error('Market provider error:', error.message);
    return res.status(503).json({ ok: false, error: error.message, providerEfficiency: providerEfficiencySnapshot(telemetry) });
  }
});

router.get('/market/sources', (_req, res) => {
  return res.json({ ok: true, ...getMarketSourceCatalog() });
});

router.get('/market/reference/fx', async (req, res) => {
  try {
    const reference = await fetchFrankfurterDailyReference({
      base: req.query.base || 'USD',
      quote: req.query.quote || 'BRL'
    });
    return res.status(reference.status === 'REFERENCE_OK' ? 200 : 206).json({
      ok: reference.status === 'REFERENCE_OK',
      reference
    });
  } catch (error) {
    const message = String(error?.message || 'FX_REFERENCE_UNAVAILABLE');
    const status = Number(error?.status);
    return res.status(status >= 400 && status < 500 ? status : 503).json({
      ok: false,
      error: message.slice(0, 200),
      tradingEligible: false
    });
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
      webSocketShadow,
      marketSources: getMarketSourceCatalog()
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
        webSocketShadow,
        marketSources: getMarketSourceCatalog()
      });
    }
    return res.status(503).json({
      ok: false,
      error: 'MARKET_STATUS_UNAVAILABLE',
      relay,
      webSocketShadow,
      marketSources: getMarketSourceCatalog()
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
  const outputsize = Math.min(Math.max(Number(req.query.outputsize || 50), 20), 200);
  try {
    const snapshots = [];
    for (const timeframe of timeframes) {
      const rawSnapshot = await getMarketSnapshot(asset, timeframe, outputsize);
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
