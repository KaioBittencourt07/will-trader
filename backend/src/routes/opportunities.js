import { Router } from 'express';
import { getMarketDataEngine, getLocalRelaySnapshot } from './market.js';
import { runWillPipeline } from '../../../engine/src/pipeline.js';
import { selectBestOpportunity } from '../../../engine/src/opportunityEngine.js';
import { createAuditEntry } from '../../../engine/src/auditLog.js';
import { dataQualityWait } from '../../../engine/src/dataGuard.js';
import { MARKET_UNIVERSES, createMarketUniverseScheduler } from '../../../data/src/marketUniverse.js';
import { createAvalonCatalog } from '../../../data/src/brokerCatalog.js';
import { assessScannerCandidate, adaptiveScanPriority, scannerTelemetry } from '../../../engine/src/scannerDiscovery.js';
import { createOpportunityLatency } from '../opportunityLatency.js';
import { createProviderEfficiencyTelemetry, providerEfficiencySnapshot } from '../../../data/src/providerEfficiency.js';

const router = Router();
const avalonCatalog = createAvalonCatalog();
// PAPER research studies a canonical provider universe. Avalon is deliberately
// not its source of truth: mapping evidence belongs to broker execution only.
const scheduler = createMarketUniverseScheduler({ universes: MARKET_UNIVERSES });
const relayScheduler = createMarketUniverseScheduler({ universes: MARKET_UNIVERSES });
let localRelayRequired = false;

function scanLimit() {
  return Math.min(Math.max(Number(process.env.MARKET_SCAN_MAX_SYMBOLS || 4), 1), 20);
}

function entryDelaySeconds(value) {
  const parsed = Number(value ?? process.env.ENTRY_DELAY_SECONDS ?? 120);
  return Number.isFinite(parsed) ? Math.min(300, Math.max(60, parsed)) : 120;
}

export function canonicalResearchAssets(assets = []) {
  const allowed = new Set(Object.values(MARKET_UNIVERSES).flat());
  const normalized = [...new Set(assets.map((asset) => String(asset).trim().toUpperCase()).filter(Boolean))];
  const unsupported = normalized.filter((asset) => !allowed.has(asset));
  if (unsupported.length) throw new Error(`Ativo fora do universo canônico de pesquisa: ${unsupported.join(', ')}.`);
  return normalized;
}

function brokerMapping() {
  return {
    broker: avalonCatalog.broker,
    status: avalonCatalog.isConfirmed() ? 'AVALON_MAPPING_VERIFIED' : 'AVALON_CATALOG_UNVERIFIED',
    catalogSource: avalonCatalog.source,
    catalogVerifiedAt: avalonCatalog.verifiedAt,
    executionAvailable: false
  };
}

router.get('/opportunities', async (req, res) => {
  const latency = createOpportunityLatency();
  const providerTelemetry = createProviderEfficiencyTelemetry(req.query.monitorCycleId ? 'paper-monitor-opportunities' : 'api-opportunities-request');
  const requestedAssets = req.query.assets
    ? String(req.query.assets).split(',').map((asset) => asset.trim().toUpperCase()).filter(Boolean)
    : null;
  let explicitAssets;
  try {
    explicitAssets = requestedAssets ? canonicalResearchAssets(requestedAssets) : null;
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message, broker: avalonCatalog.broker });
  }
  let selection;
  try {
    selection = latency.stage('universeSelectionMs', () => explicitAssets
      ? { assetClass: 'CUSTOM', assets: explicitAssets.slice(0, scanLimit()), totalAssets: explicitAssets.length, nextAsset: null, completesCycle: false }
      : scheduler.take({ assetClass: req.query.assetClass || 'ALL', limit: Math.min(Number(req.query.limit || scanLimit()), scanLimit()) }));
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message, broker: avalonCatalog.broker });
  }
  const timeframe = String(req.query.timeframe || '1min');
  const monitorCycleId = req.query.monitorCycleId ? String(req.query.monitorCycleId).slice(0, 180) : null;
  const context = {
    dataValid: true,
    requiredBars: 50,
    expirySeconds: Number(req.query.expirySeconds || process.env.EXPIRY_SECONDS || 60),
    entryDelaySeconds: entryDelaySeconds(req.query.entryDelaySeconds),
    entryWindowStartSeconds: 60,
    entryWindowEndSeconds: 300
  };
  try {
    const analyses = [];
    const candidates = [];
    const unavailable = [];
    let activeSelection = selection;
    let snapshots;
    let relayMode = false;
    try {
      if (localRelayRequired) throw new Error('LOCAL_RELAY_REQUIRED');
      snapshots = await latency.stage('marketFetchMs', () => getMarketDataEngine().getSnapshots(selection.assets, timeframe, 50, { telemetry: providerTelemetry }));
    } catch (error) {
      if (!/EACCES|network error|LOCAL_RELAY_REQUIRED/i.test(error.message)) throw error;
      localRelayRequired = true;
      activeSelection = explicitAssets
        ? { assetClass: 'CUSTOM', assets: explicitAssets.slice(0, 1), totalAssets: explicitAssets.length, nextAsset: explicitAssets[1] ?? null, completesCycle: explicitAssets.length === 1 }
        : relayScheduler.take({ assetClass: req.query.assetClass || 'ALL', limit: 1 });
      const asset = activeSelection.assets[0];
      try {
        snapshots = [{ asset, snapshot: await latency.stage('marketFetchMs', () => getLocalRelaySnapshot(asset, timeframe, 50, { telemetry: providerTelemetry })), error: null }];
      } catch (relayError) {
        if (!/cooldown|429|HTTP 404|not found|não encontrado/i.test(relayError.message)) throw relayError;
        if (/HTTP 404|not found|não encontrado/i.test(relayError.message)) relayScheduler.defer(asset, 60 * 60_000);
        return res.json({
          ok: true,
          scannedAt: new Date().toISOString(),
          timeframe,
          scanned: 0,
          unavailable: [{ asset, error: relayError.message }],
          coverage: activeSelection,
          relayMode: true,
          providerEfficiency: providerEfficiencySnapshot(providerTelemetry),
          recommendation: null,
          reason: /HTTP 404|not found|não encontrado/i.test(relayError.message)
            ? 'Ativo indisponível no feed atual; ele foi retirado temporariamente da fila de estudo.'
            : 'Feed em atualização para respeitar o limite de dados. Aguarde alguns segundos e estude novamente.'
        });
      }
      relayMode = true;
    }
    for (const { asset, snapshot, error } of snapshots) {
      if (error || !snapshot) {
        unavailable.push({ asset, error: error || 'Sem snapshot.' });
        continue;
      }
      if (snapshot.status === 'STALE' || snapshot.marketOpen === false) {
        (relayMode ? relayScheduler : scheduler).defer(asset);
      }
      const startedAt = Date.now();
      const marketContext = await latency.stage('marketContextMs', () => req.app.locals.marketContextProvider.getContext(asset));
      const decision = latency.stage('decisionPipelineMs', () => snapshot.valid === false || snapshot.marketOpen === false
        ? dataQualityWait(snapshot.marketOpen === false
          ? { ...snapshot, status: 'MARKET_CLOSED', reason: 'MARKET_CLOSED' }
          : snapshot)
        : runWillPipeline(snapshot, { ...context, macroBlocked: marketContext.macro.blocked, newsBlocked: marketContext.news.blocked }));
      const decisionContext = {
        ...context,
        macroBlocked: marketContext.macro.blocked,
        newsBlocked: marketContext.news.blocked,
        marketContext,
        decisionLatencyMs: Date.now() - startedAt,
        providerHealth: relayMode ? 'LOCAL_RELAY' : 'HEALTHY',
        prospectiveManifest: req.app.locals.prospectiveManifest,
        monitorCycleId,
        decisionId: monitorCycleId ? `${monitorCycleId}:${asset}` : undefined
      };
      const audit = latency.stage('persistenceMs', () => createAuditEntry({ signal: snapshot, decision, context: decisionContext }));
      const history = latency.stage('persistenceMs', () => req.app.locals.historyStore.recordDecision({ decision, data: snapshot, audit, context: decisionContext }));
      const candidate = latency.stage('scannerMs', () => assessScannerCandidate({ asset, snapshot, decision, context: decisionContext }));
      // The scheduler priority changes only future scan coverage. It cannot
      // make this decision executable or alter any entry threshold.
      (relayMode ? relayScheduler : scheduler).setPriority?.(asset, adaptiveScanPriority(snapshot, candidate.readiness));
      candidates.push(candidate);
      analyses.push({ asset, snapshot, decision, historyId: history.id, marketContext });
    }
    const result = latency.stage('rankingMs', () => selectBestOpportunity(analyses));
    if (result.recommendation) {
      const selected = candidates.find((item) => item.asset === result.recommendation.asset);
      if (selected) selected.stages.ranked = true;
    }
    const response = latency.stage('responsePreparationMs', () => ({
      ok: true,
      scannedAt: new Date().toISOString(),
      timeframe,
      scanned: analyses.length,
      unavailable,
      coverage: activeSelection,
      researchUniverse: 'canonical-market-v1',
      broker: avalonCatalog.broker,
      brokerMapping: brokerMapping(),
      relayMode,
      scanner: scannerTelemetry(candidates, { providerRequests: snapshots.length }),
      candidates,
      ...result,
      providerEfficiency: providerEfficiencySnapshot(providerTelemetry),
      reason: relayMode
        ? `${result.reason} Relay local ativo: ${activeSelection.assets[0]} estudado nesta janela; próxima leitura: ${activeSelection.nextAsset || 'fim da lista'}.`
        : result.reason || (unavailable.length ? 'Parte da fila não recebeu dados válidos; nenhum sinal foi liberado.' : undefined)
    }));
    response.latency = latency.snapshot();
    return res.json(response);
  } catch (error) {
    console.error('Opportunity scan error:', error.message);
    return res.status(503).json({ ok: false, error: error.message, providerEfficiency: providerEfficiencySnapshot(providerTelemetry) });
  }
});

export default router;

