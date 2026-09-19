import { Router } from 'express';
import { withCycleEvidenceRequest } from '../cycleEvidenceRequest.js';
import { getMarketDataEngine, getLocalRelaySnapshot } from './market.js';
import { runWillPipeline } from '../../../engine/src/pipeline.js';
import { selectBestOpportunity } from '../../../engine/src/opportunityEngine.js';
import { createAuditEntry } from '../../../engine/src/auditLog.js';
import { MARKET_UNIVERSES, createMarketUniverseScheduler } from '../../../data/src/marketUniverse.js';
import { assessScannerCandidate, adaptiveScanPriority, scannerTelemetry } from '../../../engine/src/scannerDiscovery.js';
import { createOpportunityLatency } from '../opportunityLatency.js';
import { createProviderEfficiencyTelemetry, providerEfficiencySnapshot } from '../../../data/src/providerEfficiency.js';
import { evaluateMarketAdmission } from '../marketAdmissionGate.js';
import {
  buildCanonicalMarketSnapshot,
  buildCanonicalStrategyInput,
  createCanonicalStudyFingerprint
} from '../canonicalMarketSnapshot.js';
import { scannerStudyRegistry } from '../scannerStudyRegistry.js';
import { deriveScannerRoundState } from '../scannerRoundState.js';
import { composeCoinbaseTwelveOperationalSnapshot } from '../coinbaseTwelveOperationalSnapshot.js';
import { composeBiquoteTwelveOperationalSnapshot } from '../biquoteTwelveOperationalSnapshot.js';

const router = Router();
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

function scannerExecutionBoundary() {
  return {
    mode: 'BROKER_AGNOSTIC_ANALYSIS',
    broker: null,
    executionAvailable: false,
    executionResponsibility: 'OPERATOR_EXTERNAL_BROKER',
    automatedBrokerExecution: false
  };
}

function dataRejectionReason(snapshot = {}) {
  if (snapshot.marketOpen === false) return 'MARKET_CLOSED';
  if (snapshot.status === 'STALE') return 'STALE_MARKET_DATA';
  if (snapshot.valid === false) return snapshot.reason || snapshot.status || 'INVALID_MARKET_DATA';
  return null;
}

function admissionProof(admission) {
  return {
    version: admission.version,
    state: admission.state,
    stage: admission.stage,
    checks: admission.checks
  };
}

function canonicalProof(canonical, fingerprint, registryClaim) {
  return {
    version: canonical.version,
    state: canonical.state,
    latestClosedCandleTimestamp: canonical.latestClosedCandleTimestamp,
    timestampAuthority: canonical.timestampAuthority,
    freshnessContractMs: canonical.freshnessContractMs,
    fingerprint: {
      version: fingerprint.version,
      hash: fingerprint.hash
    },
    dedup: {
      version: registryClaim.version,
      firstSeenAt: registryClaim.firstSeenAt ?? null
    }
  };
}

function coinbaseFeedFor(app, asset) {
  const feeds = app.locals.coinbaseTemporalFeeds;
  if (feeds instanceof Map) return feeds.get(asset) ?? null;
  if (feeds && typeof feeds === 'object') return feeds[asset] ?? null;
  return asset === 'BTC/USD' ? app.locals.coinbaseTemporalFeed ?? null : null;
}

function coinbaseTemporalSnapshot(app) {
  const feeds = app.locals.coinbaseTemporalFeeds;
  if (!(feeds instanceof Map)) return app.locals.coinbaseTemporalFeed?.health?.() ?? null;
  return Object.fromEntries([...feeds.entries()].map(([asset, feed]) => [asset, feed.health()]));
}

function operationalSnapshotFor(asset, snapshot, app, requiredBars) {
  const coinbaseFeed = coinbaseFeedFor(app, asset);
  if (coinbaseFeed) {
    const health = coinbaseFeed.health();
    if (health.enabled === true) {
      return composeCoinbaseTwelveOperationalSnapshot({
        twelveSnapshot: snapshot,
        coinbaseHealth: health,
        now: Date.now(),
        requiredBars
      });
    }
  }

  const biquoteFeed = app.locals.biquoteForexFeed;
  const biquoteHealth = biquoteFeed?.getAssetHealth?.(asset) ?? null;
  if (biquoteHealth?.enabled === true) {
    return composeBiquoteTwelveOperationalSnapshot({
      twelveSnapshot: snapshot,
      biquoteHealth,
      now: Date.now(),
      requiredBars
    });
  }

  return snapshot;
}

router.get('/opportunities', withCycleEvidenceRequest(async (req, res) => {
  const latency = createOpportunityLatency();
  const providerTelemetry = createProviderEfficiencyTelemetry(
    req.query.monitorCycleId ? 'paper-monitor-opportunities' : 'api-opportunities-request'
  );

  const requestedAssets = req.query.assets
    ? String(req.query.assets).split(',').map((asset) => asset.trim().toUpperCase()).filter(Boolean)
    : null;

  let explicitAssets;
  try {
    explicitAssets = requestedAssets ? canonicalResearchAssets(requestedAssets) : null;
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message, execution: scannerExecutionBoundary() });
  }

  let selection;
  try {
    selection = latency.stage('universeSelectionMs', () => explicitAssets
      ? {
          assetClass: 'CUSTOM',
          assets: explicitAssets.slice(0, scanLimit()),
          totalAssets: explicitAssets.length,
          nextAsset: null,
          completesCycle: false
        }
      : scheduler.take({
          assetClass: req.query.assetClass || 'FX_CRYPTO',
          limit: Math.min(Number(req.query.limit || scanLimit()), scanLimit())
        }));
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message, execution: scannerExecutionBoundary() });
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
      snapshots = await latency.stage('marketFetchMs', () =>
        getMarketDataEngine().getSnapshots(selection.assets, timeframe, 55, { telemetry: providerTelemetry })
      );
    } catch (error) {
      if (!/EACCES|network error|LOCAL_RELAY_REQUIRED/i.test(error.message)) throw error;
      localRelayRequired = true;
      activeSelection = explicitAssets
        ? {
            assetClass: 'CUSTOM',
            assets: explicitAssets.slice(0, 1),
            totalAssets: explicitAssets.length,
            nextAsset: explicitAssets[1] ?? null,
            completesCycle: explicitAssets.length === 1
          }
        : relayScheduler.take({ assetClass: req.query.assetClass || 'FX_CRYPTO', limit: 1 });
      const asset = activeSelection.assets[0];

      try {
        snapshots = [{
          asset,
          snapshot: await latency.stage('marketFetchMs', () =>
            getLocalRelaySnapshot(asset, timeframe, 55, { telemetry: providerTelemetry })
          ),
          error: null
        }];
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
          researchUniverse: 'canonical-market-v1',
          execution: scannerExecutionBoundary(),
          relayMode: true,
          providerEfficiency: providerEfficiencySnapshot(providerTelemetry),
          recommendation: null,
          roundState: {
            version: 'scanner-round-state-v1',
            state: 'NO_ADMITTED_MARKET_STUDY',
            strategicWait: false,
            admittedStudies: 0,
            rejectedObservations: 1
          },
          reason: /HTTP 404|not found|não encontrado/i.test(relayError.message)
            ? 'Ativo indisponível no feed atual; ele foi retirado temporariamente da fila de estudo.'
            : 'Feed em atualização para respeitar o limite de dados. Nenhum estudo foi criado.'
        });
      }
      relayMode = true;
    }

    for (const { asset, snapshot, error } of snapshots) {
      if (error || !snapshot) {
        unavailable.push({ asset, error: error || 'Sem snapshot.' });
        continue;
      }

      const effectiveSnapshot = operationalSnapshotFor(asset, snapshot, req.app, context.requiredBars);
      const rejection = dataRejectionReason(effectiveSnapshot);
      if (rejection) {
        (relayMode ? relayScheduler : scheduler).defer(asset);
        unavailable.push({
          asset,
          error: rejection,
          ...(effectiveSnapshot?.reasons ? { reasons: effectiveSnapshot.reasons } : {})
        });
        continue;
      }

      const admission = evaluateMarketAdmission(effectiveSnapshot, { requireAuthoritativeFreshness: true });
      if (!admission.admitted) {
        unavailable.push({
          asset,
          error: 'MARKET_ADMISSION_REJECTED',
          reasons: admission.reasons,
          admission: admissionProof(admission)
        });
        continue;
      }

      const admittedSnapshot = admission.snapshot;
      const canonical = buildCanonicalMarketSnapshot({
        snapshot: admittedSnapshot,
        admission: admissionProof(admission),
        now: Date.now(),
        requiredBars: context.requiredBars
      });

      if (!canonical.valid) {
        unavailable.push({
          asset,
          error: 'CANONICAL_SNAPSHOT_REJECTED',
          reasons: canonical.reasons,
          canonical: {
            version: canonical.version,
            state: canonical.state,
            latestClosedCandleTimestamp: canonical.latestClosedCandleTimestamp
          }
        });
        continue;
      }

      const fingerprint = createCanonicalStudyFingerprint(canonical);
      if (!fingerprint.eligible) {
        unavailable.push({ asset, error: 'STUDY_FINGERPRINT_NOT_ELIGIBLE' });
        continue;
      }

      const strategySnapshot = buildCanonicalStrategyInput({ snapshot: admittedSnapshot, canonicalSnapshot: canonical });
      if (strategySnapshot.valid === false) {
        unavailable.push({ asset, error: 'CANONICAL_STRATEGY_INPUT_REJECTED', reasons: strategySnapshot.reasons });
        continue;
      }

      const startedAt = Date.now();
      const marketContext = await latency.stage('marketContextMs', () =>
        req.app.locals.marketContextProvider.getContext(asset)
      );
      const decision = latency.stage('decisionPipelineMs', () => runWillPipeline(strategySnapshot, {
        ...context,
        macroBlocked: marketContext.macro.blocked,
        newsBlocked: marketContext.news.blocked
      }));

      // Dedup is claimed only after strategy evaluation succeeds. A transient
      // pipeline/provider-context failure therefore cannot permanently consume a study.
      const registryClaim = scannerStudyRegistry.claim(fingerprint, {
        asset,
        timeframe,
        latestClosedCandleTimestamp: canonical.latestClosedCandleTimestamp
      });
      if (!registryClaim.accepted) {
        unavailable.push({
          asset,
          error: registryClaim.reason,
          duplicate: registryClaim.duplicate,
          fingerprint: { version: fingerprint.version, hash: fingerprint.hash },
          firstSeenAt: registryClaim.firstSeenAt ?? null
        });
        continue;
      }

      const decisionContext = {
        ...context,
        macroBlocked: marketContext.macro.blocked,
        newsBlocked: marketContext.news.blocked,
        marketContext,
        decisionLatencyMs: Date.now() - startedAt,
        providerHealth: admittedSnapshot.compositeProvider === 'BIQUOTE'
          ? 'BIQUOTE_TEMPORAL+TWELVE_CLOSED_OHLC'
          : admittedSnapshot.compositeVersion
            ? 'COINBASE_TEMPORAL+TWELVE_CLOSED_OHLC'
            : relayMode ? 'LOCAL_RELAY' : 'HEALTHY',
        marketAdmission: admissionProof(admission),
        canonicalStudy: canonicalProof(canonical, fingerprint, registryClaim),
        prospectiveManifest: req.app.locals.prospectiveManifest,
        monitorCycleId,
        decisionId: monitorCycleId ? `${monitorCycleId}:${asset}:${fingerprint.hash.slice(0, 12)}` : undefined
      };

      const audit = latency.stage('persistenceMs', () => createAuditEntry({
        signal: strategySnapshot,
        decision,
        context: decisionContext
      }));
      const history = latency.stage('persistenceMs', () => (req.cycleEvidenceRecord ?? req.app.locals.historyStore.recordDecision)({
        decision,
        data: strategySnapshot,
        audit,
        context: decisionContext
      }));
      const candidate = latency.stage('scannerMs', () => assessScannerCandidate({
        asset,
        snapshot: strategySnapshot,
        decision,
        context: decisionContext
      }));

      (relayMode ? relayScheduler : scheduler).setPriority?.(
        asset,
        adaptiveScanPriority(strategySnapshot, candidate.readiness)
      );

      candidates.push(candidate);
      analyses.push({
        asset,
        snapshot: strategySnapshot,
        decision,
        historyId: history.id,
        marketContext,
        admission: { version: admission.version, state: admission.state },
        canonicalStudy: decisionContext.canonicalStudy
      });
    }

    const result = latency.stage('rankingMs', () => selectBestOpportunity(analyses));
    if (result.recommendation) {
      const selected = candidates.find((item) => item.asset === result.recommendation.asset);
      if (selected) selected.stages.ranked = true;
    }

    const roundState = deriveScannerRoundState({
      analyses,
      unavailable,
      recommendation: result.recommendation
    });

    const baseReason = roundState.reason || result.reason;
    const reason = relayMode
      ? `${baseReason} Relay local ativo: ${activeSelection.assets[0]} observado; próxima leitura: ${activeSelection.nextAsset || 'fim da lista'}.`
      : baseReason;

    const response = latency.stage('responsePreparationMs', () => ({
      ok: true,
      scannedAt: new Date().toISOString(),
      timeframe,
      scanned: analyses.length,
      unavailable,
      coverage: activeSelection,
      researchUniverse: activeSelection.assetClass === 'FX_CRYPTO' ? 'phase1-fx-crypto-v1' : 'canonical-market-v1',
      execution: scannerExecutionBoundary(),
      relayMode,
      coinbaseTemporal: coinbaseTemporalSnapshot(req.app),
      biquoteForex: req.app.locals.biquoteForexFeed?.health?.() ?? null,
      scanner: scannerTelemetry(candidates, { providerRequests: snapshots.length }),
      scannerStudyRegistry: scannerStudyRegistry.snapshot(),
      roundState,
      candidates,
      ...result,
      providerEfficiency: providerEfficiencySnapshot(providerTelemetry),
      reason
    }));

    response.latency = latency.snapshot();
    return res.json(response);
  } catch (error) {
    console.error('Opportunity scan error:', error.message);
    return res.status(503).json({
      ok: false,
      error: error.message,
      execution: scannerExecutionBoundary(),
      providerEfficiency: providerEfficiencySnapshot(providerTelemetry)
    });
  }
}));

export default router;
