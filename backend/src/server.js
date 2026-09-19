import 'dotenv/config';
import express from 'express';
import analyzeRouter from './routes/analyze.js';
import marketRouter from './routes/market.js';
import contextRouter from './routes/context.js';
import paperRouter from './routes/paper.js';
import historyRouter from './routes/history.js';
import executionRouter from './routes/execution.js';
import opportunitiesRouter from './routes/opportunities.js';
import researchRouter from './routes/research.js';
import intelligenceRouter from './routes/intelligence.js';
import oos2CollectionRouter from './routes/oos2Collection.js';
import { createManualExecutionGateway } from './execution/manualGateway.js';
import { config } from './config.js';
import { hydrateRuntimeSecrets } from './runtimeSecrets.js';
import { createHistoryStore } from '../../learning/src/historyStore.js';
import { createProspectiveManifest } from '../../learning/src/prospectiveEvidence.js';
import { createAutonomousPaperMonitor } from '../../learning/src/autonomousPaperMonitor.js';
import { createCycleEvidenceRuntime } from '../../learning/src/cycleEvidenceRuntime.js';
import { prepareOos2rEnvironment, createPreparedOos2rRuntime } from './oos2rActivation.js';
import { inspectOos2rCollectionStatus } from './oos2rStatus.js';
import { createResearchMemory } from '../../learning/src/researchMemory.js';
import { createMarketContextProvider } from '../../context/src/marketContext.js';
import { createBlsCalendarAdapter } from '../../context/src/adapters/blsCalendarAdapter.js';
import { createFedCalendarAdapter } from '../../context/src/adapters/fedCalendarAdapter.js';
import { createCompositeMacroAdapter } from '../../context/src/adapters/compositeMacroAdapter.js';
import { resolvePaperMonitorRequestTimeout } from '../../learning/src/paperMonitorTimeout.js';
import { runPaperMonitorCycle } from './paperMonitorCycle.js';
import { settleDuePaperCampaignOutcomes, PAPER_OUTCOME_SETTLEMENT_VERSION } from './paperOutcomeSettlement.js';
import { createTwelveWebSocketFeed } from '../../data/src/providers/twelveWebSocketFeed.js';
import { createCoinbaseTemporalFeed } from './coinbaseTemporalFeed.js';
import { createBiquoteForexRuntimeFeed } from './biquoteForexRuntimeFeed.js';
import { prepareHistoryContinuity } from './historyContinuity.js';
import { scannerStudyRegistry } from './scannerStudyRegistry.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const oos2rPrepared = prepareOos2rEnvironment();
const runtimeSecrets = await hydrateRuntimeSecrets();
const backendDirectory = path.dirname(fileURLToPath(import.meta.url));
const paperMonitorEnabled = process.env.WILL_PAPER_MONITOR_ENABLED === 'true';
const paperMonitorIntervalMs = Number(process.env.WILL_PAPER_MONITOR_INTERVAL_MS || 60_000);
const paperMonitorTimeout = resolvePaperMonitorRequestTimeout({
  value: process.env.WILL_PAPER_MONITOR_REQUEST_TIMEOUT_MS,
  intervalMs: paperMonitorIntervalMs
});
const paperMonitorAssetClass = String(process.env.WILL_PAPER_MONITOR_ASSET_CLASS || 'FX_CRYPTO').trim().toUpperCase();
const paperMonitorBatchSize = Math.min(4, Math.max(1, Number(process.env.WILL_PAPER_MONITOR_BATCH_SIZE || 4) || 4));
const paperOutcomeSettlementIntervalMs = Math.min(10_000, Math.max(1_000, Number(process.env.WILL_PAPER_OUTCOME_SETTLEMENT_INTERVAL_MS || 5_000) || 5_000));
const macroContextEnabled = process.env.WILL_MACRO_CONTEXT_ENABLED === 'true';
const macroCacheTtlMs = Number(process.env.WILL_MACRO_CACHE_TTL_MS || 10 * 60_000);
const historyFilePath = process.env.WILL_HISTORY_FILE || path.join(process.cwd(), 'data', 'will-history.json');
const historyContinuity = prepareHistoryContinuity({ filePath: historyFilePath });
const coinbaseTemporalEnabled = process.env.WILL_COINBASE_TEMPORAL_ENABLED === 'true';
const coinbaseTemporalSymbols = Object.freeze(['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD']);
const biquoteForexEnabled = process.env.WILL_BIQUOTE_FOREX_ENABLED === 'true';
const biquotePollIntervalMs = Number(process.env.WILL_BIQUOTE_POLL_INTERVAL_MS || 10_000);
const biquoteRequestTimeoutMs = Number(process.env.WILL_BIQUOTE_REQUEST_TIMEOUT_MS || 8_000);

const app = express();
app.locals.twelveWebSocketFeed = createTwelveWebSocketFeed({
  enabled: process.env.WILL_TWELVE_WS_ENABLED === 'true',
  apiKey: process.env.TWELVEDATA_API_KEY,
  symbols: process.env.WILL_TWELVE_WS_SYMBOLS || process.env.DEFAULT_ASSET || 'EUR/USD'
});

app.locals.coinbaseTemporalFeeds = new Map(
  coinbaseTemporalSymbols.map((symbol) => [symbol, createCoinbaseTemporalFeed({
    enabled: coinbaseTemporalEnabled,
    symbol
  })])
);
// Backward-compatible BTC alias for existing diagnostics/tests.
app.locals.coinbaseTemporalFeed = app.locals.coinbaseTemporalFeeds.get('BTC/USD');

app.locals.biquoteForexFeed = createBiquoteForexRuntimeFeed({
  enabled: biquoteForexEnabled,
  pollIntervalMs: biquotePollIntervalMs,
  requestTimeoutMs: biquoteRequestTimeoutMs
});

// Evidence-only batch metadata. It cannot place an order or alter a decision.
app.locals.prospectiveManifest = createProspectiveManifest({
  startTime: process.env.WILL_PROSPECTIVE_START_TIME || '2026-09-03T02:15:00.000Z'
});
app.locals.historyStore = createHistoryStore({ filePath: historyFilePath });
app.locals.historyContinuity = historyContinuity;
app.locals.scannerStudyRegistryHydration = scannerStudyRegistry.hydrate(app.locals.historyStore.list());
app.locals.paperOutcomeSettlement = Object.freeze({
  version: PAPER_OUTCOME_SETTLEMENT_VERSION,
  mode: 'PAPER_ONLY',
  state: 'WAITING_FOR_FIRST_PASS',
  entriesCaptured: 0,
  settled: 0,
  pending: 0,
  wins: 0,
  losses: 0,
  ties: 0,
  dataInvalid: 0,
  automatedBrokerExecution: false
});
app.locals.paperOutcomeSettlementTimer = null;

function runPaperOutcomeSettlementPass() {
  if (!paperMonitorEnabled) return app.locals.paperOutcomeSettlement;
  try {
    const settlement = settleDuePaperCampaignOutcomes({
      historyStore: app.locals.historyStore,
      coinbaseTemporalFeeds: app.locals.coinbaseTemporalFeeds,
      biquoteForexFeed: app.locals.biquoteForexFeed,
      now: Date.now()
    });
    app.locals.paperOutcomeSettlement = settlement;
    return settlement;
  } catch (error) {
    const settlement = Object.freeze({
      version: PAPER_OUTCOME_SETTLEMENT_VERSION,
      mode: 'PAPER_ONLY',
      state: 'ERROR',
      error: String(error?.message || 'PAPER_OUTCOME_SETTLEMENT_ERROR').slice(0, 180),
      automatedBrokerExecution: false
    });
    app.locals.paperOutcomeSettlement = settlement;
    return settlement;
  }
}

app.locals.cycleEvidenceRuntime = oos2rPrepared
  ? createPreparedOos2rRuntime({prepared:oos2rPrepared,historyStore:app.locals.historyStore})
  : process.env.WILL_CYCLE_EVIDENCE_ENABLED === 'true'
  ? createCycleEvidenceRuntime({
      directory: process.env.WILL_CYCLE_EVIDENCE_DIRECTORY,
      protocolId: process.env.WILL_CYCLE_EVIDENCE_PROTOCOL_ID,
      campaignId: process.env.WILL_CYCLE_EVIDENCE_CAMPAIGN_ID,
      historyStore: app.locals.historyStore
    })
  : null;
app.locals.paperMonitor = createAutonomousPaperMonitor({
  cycleEvidence: app.locals.cycleEvidenceRuntime,
  // Opt-in only. This prevents background scans from consuming provider budget
  // unless the operator explicitly enables the paper observation scheduler.
  enabled: paperMonitorEnabled,
  intervalMs: paperMonitorIntervalMs,
  filePath: process.env.WILL_PAPER_MONITOR_STATE_FILE || path.join(process.cwd(), 'data', 'will-paper-monitor-state.json'),
  logger: (event) => {
    // The monitor supplies only the bounded, redacted diagnostic fields.
    console.warn(`[PAPER monitor] ${event.status} ${event.cycleId} ${event.errorCode}: ${event.errorDetail}`);
  },
  runCycle: async ({ cycleId, capability }) => {
    const cycle = await runPaperMonitorCycle({
      baseUrl: `http://127.0.0.1:${config.port}`,
      cycleId,
      capability,
      timeout: paperMonitorTimeout,
      multiAsset: true,
      assetClass: paperMonitorAssetClass,
      limit: paperMonitorBatchSize,
      timeframe: process.env.WILL_PAPER_MONITOR_TIMEFRAME || '1min'
    });
    const settlement = runPaperOutcomeSettlementPass();
    if (settlement?.state === 'ERROR') return { ...cycle, ok: false, status: 'PAPER_OUTCOME_SETTLEMENT_ERROR', outcomeSettlement: settlement };
    return { ...cycle, outcomeSettlement: settlement };
  }
});
app.locals.researchMemory = createResearchMemory({
  filePath: process.env.WILL_RESEARCH_FILE || path.join(process.cwd(), 'data', 'will-research.json'),
  minimumSamples: Number(process.env.WILL_RESEARCH_MINIMUM_SAMPLES || 30)
});
app.locals.executionGateway = createManualExecutionGateway();

// Official macro context is explicit opt-in. Merely starting WILL with the
// default configuration performs no BLS/Fed request. The composite adapter is
// fail-closed and cached so a missing required source becomes UNKNOWN, never LOW.
app.locals.macroContextAdapter = macroContextEnabled
  ? createCompositeMacroAdapter({
      adapters: [createBlsCalendarAdapter(), createFedCalendarAdapter()],
      cacheTtlMs: Number.isFinite(macroCacheTtlMs) && macroCacheTtlMs > 0 ? macroCacheTtlMs : 10 * 60_000
    })
  : null;
app.locals.marketContextProvider = createMarketContextProvider({ macroAdapter: app.locals.macroContextAdapter, newsAdapter: null });

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', config.dashboardOrigin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '256kb' }));
app.use('/dashboard', express.static(path.resolve(backendDirectory, '../../dashboard')));

app.get('/health', (_req, res) => {
  const coinbaseTemporal = Object.fromEntries(
    [...app.locals.coinbaseTemporalFeeds.entries()].map(([symbol, feed]) => {
      const health = feed.health();
      return [symbol, {
        enabled: health.enabled,
        running: health.running,
        state: health.state,
        ready: health.ready,
        lastError: health.lastError,
        latestTickAt: health.latestTick?.eventTimeRaw ?? null,
        retainedOutcomeReferences: health.retainedOutcomeReferences ?? 0
      }];
    })
  );

  res.json({
    ok: true,
    service: 'will-trader-backend',
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    marketProvider: 'twelvedata',
    marketConfigured: runtimeSecrets.twelveData.configured,
    marketCredentialSource: runtimeSecrets.twelveData.source,
    coinbaseTemporalEnabled,
    coinbaseTemporalSymbols,
    coinbaseTemporal,
    biquoteForexEnabled,
    biquoteForex: app.locals.biquoteForexFeed.health(),
    historyPersistence: {
      version: historyContinuity.version,
      loadedRecords: app.locals.historyStore.list().length,
      backupCreated: historyContinuity.backupCreated,
      persistent: true
    },
    scannerStudyRegistry: { ...scannerStudyRegistry.snapshot(), hydration: app.locals.scannerStudyRegistryHydration },
    paperMonitorEnabled,
    paperMonitorConfig: {
      mode: 'PAPER_MULTI_ASSET',
      assetClass: paperMonitorAssetClass,
      batchSize: paperMonitorBatchSize,
      intervalMs: paperMonitorIntervalMs,
      outcomeSettlementIntervalMs: paperOutcomeSettlementIntervalMs,
      automatedBrokerExecution: false
    },
    paperOutcomeSettlement: app.locals.paperOutcomeSettlement,
    macroContextEnabled,
    macroContext: app.locals.macroContextAdapter?.health?.() ?? null,
    newsContextEnabled: false
  });
});

app.get('/api/oos2r/status', (_req, res) => {
  const status=inspectOos2rCollectionStatus({
    evidenceDirectory:process.env.WILL_CYCLE_EVIDENCE_DIRECTORY
  });
  res.status(status.ok ? 200 : 503).json(status);
});
app.get('/api/paper-monitor', (_req, res) => {
  res.json({ ok: true, monitor: app.locals.paperMonitor.health(), outcomeSettlement: app.locals.paperOutcomeSettlement });
});

app.use('/api', analyzeRouter);
app.use('/api', marketRouter);
app.use('/api', contextRouter);
app.use('/api', intelligenceRouter);
app.use('/api', paperRouter);
app.use('/api', historyRouter);
app.use('/api', executionRouter);
app.use('/api', opportunitiesRouter);
app.use('/api', researchRouter);
app.use('/api', oos2CollectionRouter);

const server = app.listen(config.port, () => {
  console.log(`WILL TRADER backend running on port ${config.port}`);
  console.log(`WILL history loaded: ${app.locals.historyStore.list().length} record(s); backup=${historyContinuity.backupCreated}`);
  console.log(`WILL scanner dedup hydrated: ${app.locals.scannerStudyRegistryHydration.loaded} fingerprint(s); registry=${scannerStudyRegistry.snapshot().size}`);
  app.locals.twelveWebSocketFeed.start();
  for (const feed of app.locals.coinbaseTemporalFeeds.values()) feed.start();
  app.locals.biquoteForexFeed.start();
  app.locals.paperMonitor.start();
  if (paperMonitorEnabled && !app.locals.paperOutcomeSettlementTimer) {
    app.locals.paperOutcomeSettlementTimer = setInterval(runPaperOutcomeSettlementPass, paperOutcomeSettlementIntervalMs);
  }
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`WILL TRADER shutting down on ${signal}`);
  try { app.locals.twelveWebSocketFeed.stop(); } catch {}
  for (const feed of app.locals.coinbaseTemporalFeeds.values()) {
    try { feed.stop(); } catch {}
  }
  try { app.locals.biquoteForexFeed.stop(); } catch {}
  try { app.locals.paperMonitor.stop(); } catch {}
  if (app.locals.paperOutcomeSettlementTimer) {
    clearInterval(app.locals.paperOutcomeSettlementTimer);
    app.locals.paperOutcomeSettlementTimer = null;
  }

  const forceExit = setTimeout(() => process.exit(0), 3_000);
  forceExit.unref?.();
  server.close(() => {
    clearTimeout(forceExit);
    process.exit(0);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => shutdown(signal));
