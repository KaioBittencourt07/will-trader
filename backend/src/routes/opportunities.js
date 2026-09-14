import { Router } from 'express';
import { getMarketDataEngine, getLocalRelaySnapshot } from './market.js';
import { runWillPipeline } from '../../../engine/src/pipeline.js';
import { selectBestOpportunity } from '../../../engine/src/opportunityEngine.js';
import { createAuditEntry } from '../../../engine/src/auditLog.js';
import {
  MARKET_UNIVERSES,
  createMarketUniverseScheduler
} from '../../../data/src/marketUniverse.js';
import {
  assessScannerCandidate,
  adaptiveScanPriority,
  scannerTelemetry
} from '../../../engine/src/scannerDiscovery.js';
import { createOpportunityLatency } from '../opportunityLatency.js';
import {
  createProviderEfficiencyTelemetry,
  providerEfficiencySnapshot
} from '../../../data/src/providerEfficiency.js';
import { evaluateMarketAdmission } from '../marketAdmissionGate.js';

const router = Router();

/*
 * WILL research is broker-agnostic.
 *
 * O scanner:
 * - pesquisa mercado;
 * - valida dados;
 * - executa análise;
 * - classifica oportunidades;
 * - registra evidência.
 *
 * Ele NÃO envia ordens para corretoras.
 */
const scheduler = createMarketUniverseScheduler({
  universes: MARKET_UNIVERSES
});

const relayScheduler = createMarketUniverseScheduler({
  universes: MARKET_UNIVERSES
});

let localRelayRequired = false;

function scanLimit() {
  return Math.min(
    Math.max(Number(process.env.MARKET_SCAN_MAX_SYMBOLS || 4), 1),
    20
  );
}

function entryDelaySeconds(value) {
  const parsed = Number(
    value ??
    process.env.ENTRY_DELAY_SECONDS ??
    120
  );

  return Number.isFinite(parsed)
    ? Math.min(300, Math.max(60, parsed))
    : 120;
}

export function canonicalResearchAssets(assets = []) {
  const allowed = new Set(
    Object.values(MARKET_UNIVERSES).flat()
  );

  const normalized = [
    ...new Set(
      assets
        .map((asset) =>
          String(asset).trim().toUpperCase()
        )
        .filter(Boolean)
    )
  ];

  const unsupported = normalized.filter(
    (asset) => !allowed.has(asset)
  );

  if (unsupported.length) {
    throw new Error(
      `Ativo fora do universo canônico de pesquisa: ${unsupported.join(', ')}.`
    );
  }

  return normalized;
}

function scannerExecutionBoundary() {
  return {
    mode: 'BROKER_AGNOSTIC_ANALYSIS',
    broker: null,
    executionAvailable: false,
    executionResponsibility:
      'OPERATOR_EXTERNAL_BROKER',
    automatedBrokerExecution: false
  };
}

/*
 * Primeira barreira operacional.
 *
 * Esta função elimina erros óbvios antes mesmo de
 * executar o Market Admission Gate completo.
 */
function dataRejectionReason(snapshot = {}) {
  if (snapshot.marketOpen === false) {
    return 'MARKET_CLOSED';
  }

  if (snapshot.status === 'STALE') {
    return 'STALE_MARKET_DATA';
  }

  if (snapshot.valid === false) {
    return (
      snapshot.reason ||
      snapshot.status ||
      'INVALID_MARKET_DATA'
    );
  }

  return null;
}

router.get('/opportunities', async (req, res) => {
  const latency = createOpportunityLatency();

  const providerTelemetry =
    createProviderEfficiencyTelemetry(
      req.query.monitorCycleId
        ? 'paper-monitor-opportunities'
        : 'api-opportunities-request'
    );

  const requestedAssets = req.query.assets
    ? String(req.query.assets)
        .split(',')
        .map((asset) =>
          asset.trim().toUpperCase()
        )
        .filter(Boolean)
    : null;

  let explicitAssets;

  try {
    explicitAssets = requestedAssets
      ? canonicalResearchAssets(requestedAssets)
      : null;
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error.message,
      execution: scannerExecutionBoundary()
    });
  }

  let selection;

  try {
    selection = latency.stage(
      'universeSelectionMs',
      () =>
        explicitAssets
          ? {
              assetClass: 'CUSTOM',
              assets: explicitAssets.slice(
                0,
                scanLimit()
              ),
              totalAssets: explicitAssets.length,
              nextAsset: null,
              completesCycle: false
            }
          : scheduler.take({
              assetClass:
                req.query.assetClass || 'ALL',
              limit: Math.min(
                Number(
                  req.query.limit ||
                  scanLimit()
                ),
                scanLimit()
              )
            })
    );
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error.message,
      execution: scannerExecutionBoundary()
    });
  }

  const timeframe = String(
    req.query.timeframe || '1min'
  );

  const monitorCycleId =
    req.query.monitorCycleId
      ? String(
          req.query.monitorCycleId
        ).slice(0, 180)
      : null;

  const context = {
    dataValid: true,
    requiredBars: 50,

    expirySeconds: Number(
      req.query.expirySeconds ||
      process.env.EXPIRY_SECONDS ||
      60
    ),

    entryDelaySeconds:
      entryDelaySeconds(
        req.query.entryDelaySeconds
      ),

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

    /*
     * PRIMEIRA FASE:
     * tenta usar o MarketDataEngine direto.
     *
     * Caso o ambiente bloqueie a conexão externa,
     * muda para relay local.
     */
    try {
      if (localRelayRequired) {
        throw new Error(
          'LOCAL_RELAY_REQUIRED'
        );
      }

      snapshots = await latency.stage(
        'marketFetchMs',
        () =>
          getMarketDataEngine().getSnapshots(
            selection.assets,
            timeframe,
            50,
            {
              telemetry:
                providerTelemetry
            }
          )
      );
    } catch (error) {
      if (
        !/EACCES|network error|LOCAL_RELAY_REQUIRED/i.test(
          error.message
        )
      ) {
        throw error;
      }

      localRelayRequired = true;

      activeSelection = explicitAssets
        ? {
            assetClass: 'CUSTOM',
            assets:
              explicitAssets.slice(0, 1),
            totalAssets:
              explicitAssets.length,
            nextAsset:
              explicitAssets[1] ??
              null,
            completesCycle:
              explicitAssets.length === 1
          }
        : relayScheduler.take({
            assetClass:
              req.query.assetClass ||
              'ALL',
            limit: 1
          });

      const asset =
        activeSelection.assets[0];

      try {
        snapshots = [
          {
            asset,

            snapshot:
              await latency.stage(
                'marketFetchMs',
                () =>
                  getLocalRelaySnapshot(
                    asset,
                    timeframe,
                    50,
                    {
                      telemetry:
                        providerTelemetry
                    }
                  )
              ),

            error: null
          }
        ];
      } catch (relayError) {
        if (
          !/cooldown|429|HTTP 404|not found|não encontrado/i.test(
            relayError.message
          )
        ) {
          throw relayError;
        }

        if (
          /HTTP 404|not found|não encontrado/i.test(
            relayError.message
          )
        ) {
          relayScheduler.defer(
            asset,
            60 * 60_000
          );
        }

        return res.json({
          ok: true,

          scannedAt:
            new Date().toISOString(),

          timeframe,

          scanned: 0,

          unavailable: [
            {
              asset,
              error:
                relayError.message
            }
          ],

          coverage:
            activeSelection,

          researchUniverse:
            'canonical-market-v1',

          execution:
            scannerExecutionBoundary(),

          relayMode: true,

          providerEfficiency:
            providerEfficiencySnapshot(
              providerTelemetry
            ),

          recommendation: null,

          reason:
            /HTTP 404|not found|não encontrado/i.test(
              relayError.message
            )
              ? 'Ativo indisponível no feed atual; ele foi retirado temporariamente da fila de estudo.'
              : 'Feed em atualização para respeitar o limite de dados. Aguarde alguns segundos e estude novamente.'
        });
      }

      relayMode = true;
    }

    /*
     * SEGUNDA FASE:
     *
     * Cada observação precisa passar por:
     *
     * RAW OBSERVATION
     *      ↓
     * DATA REJECTION
     *      ↓
     * MARKET ADMISSION GATE
     *      ↓
     * DATA_ADMITTED
     *      ↓
     * WILL PIPELINE
     */
    for (
      const {
        asset,
        snapshot,
        error
      } of snapshots
    ) {
      /*
       * Provider não conseguiu produzir
       * observação.
       */
      if (error || !snapshot) {
        unavailable.push({
          asset,
          error:
            error ||
            'Sem snapshot.'
        });

        continue;
      }

      /*
       * Rejeições básicas.
       *
       * Isto NÃO é estudo.
       */
      const rejection =
        dataRejectionReason(snapshot);

      if (rejection) {
        (
          relayMode
            ? relayScheduler
            : scheduler
        ).defer(asset);

        unavailable.push({
          asset,
          error: rejection
        });

        continue;
      }

      /*
       * MARKET ADMISSION GATE V1
       *
       * Um snapshot só chega ao WILL Core
       * se provar:
       *
       * - estrutura válida;
       * - mercado aberto;
       * - dado válido;
       * - features prontas;
       * - timestamp authority;
       * - freshness authority.
       */
      const admission =
        evaluateMarketAdmission(
          snapshot,
          {
            requireAuthoritativeFreshness:
              true
          }
        );

      /*
       * REJEIÇÃO DO GATE.
       *
       * Muito importante:
       *
       * - NÃO executa WILL Core;
       * - NÃO cria WAIT;
       * - NÃO grava histórico;
       * - NÃO alimenta Learning Lab;
       * - NÃO vira candidato.
       */
      if (!admission.admitted) {
        unavailable.push({
          asset,

          error:
            'MARKET_ADMISSION_REJECTED',

          reasons:
            admission.reasons,

          admission: {
            version:
              admission.version,

            state:
              admission.state,

            stage:
              admission.stage,

            checks:
              admission.checks
          }
        });

        continue;
      }

      /*
       * A PARTIR DAQUI:
       *
       * SOMENTE snapshot oficialmente
       * admitido.
       */
      const admittedSnapshot =
        admission.snapshot;

      const startedAt =
        Date.now();

      /*
       * Contexto adicional.
       *
       * Macro/news continuam podendo
       * bloquear operação, mas não
       * alteram a integridade do dado.
       */
      const marketContext =
        await latency.stage(
          'marketContextMs',
          () =>
            req.app.locals
              .marketContextProvider
              .getContext(asset)
        );

      /*
       * WILL STRATEGY PIPELINE
       *
       * Aqui nasce um verdadeiro estudo.
       */
      const decision =
        latency.stage(
          'decisionPipelineMs',
          () =>
            runWillPipeline(
              admittedSnapshot,
              {
                ...context,

                macroBlocked:
                  marketContext
                    .macro
                    .blocked,

                newsBlocked:
                  marketContext
                    .news
                    .blocked
              }
            )
        );

      /*
       * Contexto persistido junto
       * da decisão.
       */
      const decisionContext = {
        ...context,

        macroBlocked:
          marketContext
            .macro
            .blocked,

        newsBlocked:
          marketContext
            .news
            .blocked,

        marketContext,

        decisionLatencyMs:
          Date.now() -
          startedAt,

        providerHealth:
          relayMode
            ? 'LOCAL_RELAY'
            : 'HEALTHY',

        /*
         * Prova explícita de que o
         * Market Admission Gate aprovou
         * este estudo.
         */
        marketAdmission: {
          version:
            admission.version,

          state:
            admission.state,

          stage:
            admission.stage,

          checks:
            admission.checks
        },

        prospectiveManifest:
          req.app.locals
            .prospectiveManifest,

        monitorCycleId,

        decisionId:
          monitorCycleId
            ? `${monitorCycleId}:${asset}`
            : undefined
      };

      /*
       * AUDITORIA
       */
      const audit =
        latency.stage(
          'persistenceMs',
          () =>
            createAuditEntry({
              signal:
                admittedSnapshot,

              decision,

              context:
                decisionContext
            })
        );

      /*
       * HISTÓRICO
       *
       * Somente dados admitidos chegam aqui.
       */
      const history =
        latency.stage(
          'persistenceMs',
          () =>
            req.app.locals
              .historyStore
              .recordDecision({
                decision,

                data:
                  admittedSnapshot,

                audit,

                context:
                  decisionContext
              })
        );

      /*
       * SCANNER / READINESS
       */
      const candidate =
        latency.stage(
          'scannerMs',
          () =>
            assessScannerCandidate({
              asset,

              snapshot:
                admittedSnapshot,

              decision,

              context:
                decisionContext
            })
        );

      /*
       * Prioridade futura deste ativo.
       */
      (
        relayMode
          ? relayScheduler
          : scheduler
      ).setPriority?.(
        asset,

        adaptiveScanPriority(
          admittedSnapshot,
          candidate.readiness
        )
      );

      candidates.push(candidate);

      /*
       * Analyses agora contém
       * SOMENTE estudos que passaram
       * pelo Market Admission Gate.
       */
      analyses.push({
        asset,

        snapshot:
          admittedSnapshot,

        decision,

        historyId:
          history.id,

        marketContext,

        admission: {
          version:
            admission.version,

          state:
            admission.state
        }
      });
    }

    /*
     * RANKING
     *
     * Como analyses só contém snapshots
     * admitidos, o ranking agora também
     * trabalha somente com estudos reais.
     */
    const result =
      latency.stage(
        'rankingMs',
        () =>
          selectBestOpportunity(
            analyses
          )
      );

    /*
     * Marca o candidato selecionado
     * no pipeline de descoberta.
     */
    if (result.recommendation) {
      const selected =
        candidates.find(
          (item) =>
            item.asset ===
            result.recommendation
              .asset
        );

      if (selected) {
        selected.stages.ranked =
          true;
      }
    }

    /*
     * RESPOSTA DA ROTA
     */
    const response =
      latency.stage(
        'responsePreparationMs',
        () => ({
          ok: true,

          scannedAt:
            new Date().toISOString(),

          timeframe,

          /*
           * scanned representa agora
           * estudos admitidos,
           * não tentativas de leitura.
           */
          scanned:
            analyses.length,

          unavailable,

          coverage:
            activeSelection,

          researchUniverse:
            'canonical-market-v1',

          execution:
            scannerExecutionBoundary(),

          relayMode,

          scanner:
            scannerTelemetry(
              candidates,
              {
                providerRequests:
                  snapshots.length
              }
            ),

          candidates,

          ...result,

          providerEfficiency:
            providerEfficiencySnapshot(
              providerTelemetry
            ),

          reason:
            relayMode
              ? `${
                  result.reason ||
                  'Nenhum estudo válido nesta janela.'
                } Relay local ativo: ${
                  activeSelection
                    .assets[0]
                } observado; próxima leitura: ${
                  activeSelection
                    .nextAsset ||
                  'fim da lista'
                }.`
              : result.reason ||
                (
                  unavailable.length
                    ? 'Parte da fila não recebeu dados admitidos; nenhum estudo foi gravado.'
                    : undefined
                )
        })
      );

    response.latency =
      latency.snapshot();

    return res.json(response);
  } catch (error) {
    console.error(
      'Opportunity scan error:',
      error.message
    );

    return res
      .status(503)
      .json({
        ok: false,

        error:
          error.message,

        execution:
          scannerExecutionBoundary(),

        providerEfficiency:
          providerEfficiencySnapshot(
            providerTelemetry
          )
      });
  }
});

export default router;
