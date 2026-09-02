import { Router } from 'express';
import { getMarketDataEngine, getLocalRelaySnapshot } from './market.js';
import { runWillPipeline } from '../../../engine/src/pipeline.js';
import { selectBestOpportunity } from '../../../engine/src/opportunityEngine.js';
import { createAuditEntry } from '../../../engine/src/auditLog.js';
import { dataQualityWait } from '../../../engine/src/dataGuard.js';
import { createMarketUniverseScheduler } from '../../../data/src/marketUniverse.js';
import { createAvalonCatalog } from '../../../data/src/brokerCatalog.js';
import { assessScannerCandidate, adaptiveScanPriority, scannerTelemetry } from '../../../engine/src/scannerDiscovery.js';

const router = Router();
const avalonCatalog = createAvalonCatalog();
const scheduler = createMarketUniverseScheduler({ universes: avalonCatalog.universes });
const relayScheduler = createMarketUniverseScheduler({ universes: avalonCatalog.universes });
let localRelayRequired = false;

function scanLimit() {
  return Math.min(Math.max(Number(process.env.MARKET_SCAN_MAX_SYMBOLS || 4), 1), 20);
}

function entryDelaySeconds(value) {
  const parsed = Number(value ?? process.env.ENTRY_DELAY_SECONDS ?? 120);
  return Number.isFinite(parsed) ? Math.min(300, Math.max(60, parsed)) : 120;
}

router.get('/opportunities', async (req, res) => {
  const requestedAssets = req.query.assets
    ? String(req.query.assets).split(',').map((asset) => asset.trim().toUpperCase()).filter(Boolean)
    : null;
  let explicitAssets;
  try {
    explicitAssets = requestedAssets ? avalonCatalog.assertAllowed(requestedAssets) : null;
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message, broker: avalonCatalog.broker });
  }
  let selection;
  try {
    selection = explicitAssets
      ? { assetClass: 'CUSTOM', assets: explicitAssets.slice(0, scanLimit()), totalAssets: explicitAssets.length, nextAsset: null, completesCycle: false }
      : scheduler.take({ assetClass: req.query.assetClass || 'ALL', limit: Math.min(Number(req.query.limit || scanLimit()), scanLimit()) });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message, broker: avalonCatalog.broker });
  }
  const timeframe = String(req.query.timeframe || '1min');
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
      snapshots = await getMarketDataEngine().getSnapshots(selection.assets, timeframe, 50);
    } catch (error) {
      if (!/EACCES|network error|LOCAL_RELAY_REQUIRED/i.test(error.message)) throw error;
      localRelayRequired = true;
      activeSelection = explicitAssets
        ? { assetClass: 'CUSTOM', assets: explicitAssets.slice(0, 1), totalAssets: explicitAssets.length, nextAsset: explicitAssets[1] ?? null, completesCycle: explicitAssets.length === 1 }
        : relayScheduler.take({ assetClass: req.query.assetClass || 'ALL', limit: 1 });
      const asset = activeSelection.assets[0];
      try {
        snapshots = [{ asset, snapshot: await getLocalRelaySnapshot(asset, timeframe, 50), error: null }];
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
      const decision = snapshot.valid === false || snapshot.marketOpen === false
        ? dataQualityWait(snapshot.marketOpen === false
          ? { ...snapshot, status: 'MARKET_CLOSED', reason: 'MARKET_CLOSED' }
          : snapshot)
        : runWillPipeline(snapshot, context);
      const decisionContext = { ...context, decisionLatencyMs: Date.now() - startedAt };
      const audit = createAuditEntry({ signal: snapshot, decision, context: decisionContext });
      const history = req.app.locals.historyStore.recordDecision({ decision, data: snapshot, audit, context: decisionContext });
      const candidate = assessScannerCandidate({ asset, snapshot, decision, context: decisionContext });
      // The scheduler priority changes only future scan coverage. It cannot
      // make this decision executable or alter any entry threshold.
      (relayMode ? relayScheduler : scheduler).setPriority?.(asset, adaptiveScanPriority(snapshot, candidate.readiness));
      candidates.push(candidate);
      analyses.push({ asset, snapshot, decision, historyId: history.id });
    }
    const result = selectBestOpportunity(analyses);
    if (result.recommendation) {
      const selected = candidates.find((item) => item.asset === result.recommendation.asset);
      if (selected) selected.stages.ranked = true;
    }
    return res.json({
      ok: true,
      scannedAt: new Date().toISOString(),
      timeframe,
      scanned: analyses.length,
      unavailable,
      coverage: activeSelection,
      broker: avalonCatalog.broker,
      catalogSource: avalonCatalog.source,
      relayMode,
      scanner: scannerTelemetry(candidates, { providerRequests: snapshots.length }),
      candidates,
      ...result,
      reason: relayMode
        ? `${result.reason} Relay local ativo: ${activeSelection.assets[0]} estudado nesta janela; próxima leitura: ${activeSelection.nextAsset || 'fim da lista'}.`
        : result.reason || (unavailable.length ? 'Parte da fila não recebeu dados válidos; nenhum sinal foi liberado.' : undefined)
    });
  } catch (error) {
    console.error('Opportunity scan error:', error.message);
    return res.status(503).json({ ok: false, error: error.message });
  }
});

export default router;
