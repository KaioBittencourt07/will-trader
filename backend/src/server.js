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
import { createManualExecutionGateway } from './execution/manualGateway.js';
import { config } from './config.js';
import { createHistoryStore } from '../../learning/src/historyStore.js';
import { createProspectiveManifest } from '../../learning/src/prospectiveEvidence.js';
import { createAutonomousPaperMonitor } from '../../learning/src/autonomousPaperMonitor.js';
import { createResearchMemory } from '../../learning/src/researchMemory.js';
import { createMarketContextProvider } from '../../context/src/marketContext.js';
import { prospectiveResearchGate } from '../../data/src/providers/prospectiveResearchGate.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDirectory = path.dirname(fileURLToPath(import.meta.url));

const app = express();
// Evidence-only batch metadata. It cannot place an order or alter a decision.
app.locals.prospectiveManifest = createProspectiveManifest({
  startTime: process.env.WILL_PROSPECTIVE_START_TIME || '2026-09-03T02:15:00.000Z'
});
app.locals.historyStore = createHistoryStore({
  filePath: process.env.WILL_HISTORY_FILE || path.join(process.cwd(), 'data', 'will-history.json')
});
app.locals.paperMonitor = createAutonomousPaperMonitor({
  // This is an observation scheduler only. Set false to stop it explicitly.
  enabled: process.env.WILL_PAPER_MONITOR_ENABLED !== 'false',
  intervalMs: Number(process.env.WILL_PAPER_MONITOR_INTERVAL_MS || 60_000),
  filePath: process.env.WILL_PAPER_MONITOR_STATE_FILE || path.join(process.cwd(), 'data', 'will-paper-monitor-state.json'),
  runCycle: async ({ cycleId }) => {
    // A prospective research cycle is permitted only after real provider data
    // passes the diagnostic gate. Broker mapping is intentionally irrelevant
    // here and remains a separate manual execution concern.
    const diagnosticUrl = new URL(`http://127.0.0.1:${config.port}/api/market/diagnostic`);
    diagnosticUrl.searchParams.set('asset', process.env.DEFAULT_ASSET || 'EUR/USD');
    diagnosticUrl.searchParams.set('timeframe', process.env.WILL_PAPER_MONITOR_TIMEFRAME || '1min');
    const diagnosticResponse = await fetch(diagnosticUrl, { signal: AbortSignal.timeout(30_000) });
    const diagnostic = await diagnosticResponse.json();
    const gate = prospectiveResearchGate(diagnostic);
    if (!diagnosticResponse.ok || !gate.ready) {
      return {
        ok: false,
        status: gate.status,
        scanned: 0,
        recommendation: null
      };
    }
    const url = new URL(`http://127.0.0.1:${config.port}/api/opportunities`);
    url.searchParams.set('limit', '1');
    url.searchParams.set('timeframe', process.env.WILL_PAPER_MONITOR_TIMEFRAME || '1min');
    url.searchParams.set('monitorCycleId', cycleId);
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const body = await response.json();
    return {
      ok: response.ok && body?.ok === true && !body?.status && !(body?.unavailable?.length),
      status: body?.status ?? null,
      scanned: body?.scanned ?? 0,
      recommendation: body?.recommendation ? body.recommendation.asset : null
    };
  }
});
app.locals.researchMemory = createResearchMemory({
  filePath: process.env.WILL_RESEARCH_FILE || path.join(process.cwd(), 'data', 'will-research.json'),
  minimumSamples: Number(process.env.WILL_RESEARCH_MINIMUM_SAMPLES || 30)
});
app.locals.executionGateway = createManualExecutionGateway();
// No external adapter is configured by default: the context remains explicitly
// UNKNOWN rather than being fabricated as low risk.
app.locals.marketContextProvider = createMarketContextProvider();

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
  res.json({
    ok: true,
    service: 'will-trader-backend',
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    marketProvider: 'twelvedata',
    marketConfigured: Boolean(process.env.TWELVEDATA_API_KEY)
  });
});

app.get('/api/paper-monitor', (_req, res) => {
  res.json({ ok: true, monitor: app.locals.paperMonitor.health() });
});

app.use('/api', analyzeRouter);
app.use('/api', marketRouter);
app.use('/api', contextRouter);
app.use('/api', paperRouter);
app.use('/api', historyRouter);
app.use('/api', executionRouter);
app.use('/api', opportunitiesRouter);
app.use('/api', researchRouter);

app.listen(config.port, () => {
  console.log(`WILL TRADER backend running on port ${config.port}`);
  app.locals.paperMonitor.start();
});

