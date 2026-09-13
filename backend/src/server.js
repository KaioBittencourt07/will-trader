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
import { resolvePaperMonitorRequestTimeout } from '../../learning/src/paperMonitorTimeout.js';
import { runPaperMonitorCycle } from './paperMonitorCycle.js';
import { createTwelveWebSocketFeed } from '../../data/src/providers/twelveWebSocketFeed.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDirectory = path.dirname(fileURLToPath(import.meta.url));
const paperMonitorIntervalMs = Number(process.env.WILL_PAPER_MONITOR_INTERVAL_MS || 60_000);
const paperMonitorTimeout = resolvePaperMonitorRequestTimeout({
  value: process.env.WILL_PAPER_MONITOR_REQUEST_TIMEOUT_MS,
  intervalMs: paperMonitorIntervalMs
});

const app = express();
app.locals.twelveWebSocketFeed = createTwelveWebSocketFeed({
  enabled: process.env.WILL_TWELVE_WS_ENABLED === 'true',
  apiKey: process.env.TWELVEDATA_API_KEY,
  symbols: process.env.WILL_TWELVE_WS_SYMBOLS || process.env.DEFAULT_ASSET || 'EUR/USD'
});
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
  intervalMs: paperMonitorIntervalMs,
  filePath: process.env.WILL_PAPER_MONITOR_STATE_FILE || path.join(process.cwd(), 'data', 'will-paper-monitor-state.json'),
  logger: (event) => {
    // The monitor supplies only the bounded, redacted diagnostic fields.
    console.warn(`[PAPER monitor] ${event.status} ${event.cycleId} ${event.errorCode}: ${event.errorDetail}`);
  },
  runCycle: ({ cycleId }) => runPaperMonitorCycle({
    baseUrl: `http://127.0.0.1:${config.port}`,
    cycleId,
    timeout: paperMonitorTimeout,
    asset: process.env.DEFAULT_ASSET || 'EUR/USD',
    timeframe: process.env.WILL_PAPER_MONITOR_TIMEFRAME || '1min'
  })
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
  app.locals.twelveWebSocketFeed.start();
  app.locals.paperMonitor.start();
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => app.locals.twelveWebSocketFeed.stop());
}

