import fs from 'node:fs';
import path from 'node:path';
import { attributeOutcome } from './errorAttribution.js';
import { assessFamiliarity, createStateFingerprint } from './stateFingerprint.js';
import { assessSignalLifecycle } from '../../engine/src/signalLifecycle.js';
import { assessDisagreement } from '../../engine/src/disagreement.js';
import { assessDecisionRobustness } from '../../engine/src/robustness.js';
import { runFeatureAblation } from './featureAblation.js';

const OUTCOMES = new Set(['WIN', 'LOSS', 'VOID', 'TIE', 'DATA_INVALID']);

function version(value, fallback) {
  const normalized = String(value ?? fallback).trim();
  return normalized.slice(0, 120) || fallback;
}

function featureSnapshot(data = {}, decision = {}) {
  const keys = [
    'trend', 'momentum', 'structure', 'volatility', 'confirmations', 'candleCount',
    'technicalModel', 'realizedVolatility', 'breakout', 'rejection', 'pullback', 'reversal',
    'patternDirection', 'patternModel', 'featureVersion', 'featureStatus', 'atr', 'bodyRangeRatio',
    'closeLocationValue', 'breakoutStrength', 'pullbackDepthAtr', 'rangeCompression', 'rangeExpansion'
  ];
  return Object.fromEntries(keys.map((key) => [key, data[key] ?? decision[key] ?? null]));
}

function dataQuality(data = {}, context = {}) {
  return {
    valid: data.valid !== false,
    status: data.status ?? null,
    ageMs: Number.isFinite(data.ageMs) ? data.ageMs : null,
    source: data.source ?? null,
    quoteTimestamp: data.quoteTimestamp ?? null,
    candleTimestamp: data.candleTimestamp ?? null,
    candleCount: Number.isFinite(data.candleCount) ? data.candleCount : null,
    requiredBars: Number.isFinite(Number(context.requiredBars)) ? Number(context.requiredBars) : null
  };
}

function provenance(data = {}, context = {}) {
  return {
    provider: data.provider ?? data.source ?? null,
    symbol: data.symbol ?? data.asset ?? null,
    eventTimestamp: data.eventTimestamp ?? data.timestamp ?? null,
    receiveTimestamp: data.receiveTimestamp ?? null,
    ingestTimestamp: context.ingestTimestamp ?? null,
    source: data.source ?? null,
    payloadHash: data.payloadHash ?? null,
    sequence: data.sequence ?? null
  };
}

export function createHistoryStore({ filePath = null, now = () => new Date().toISOString(), id = () => crypto.randomUUID() } = {}) {
  let records = [];
  if (filePath && fs.existsSync(filePath)) {
    const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(saved)) throw new Error('Histórico persistido inválido.');
    records = saved;
  }
  function persist() {
    if (!filePath) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(records, null, 2));
    fs.renameSync(temporary, filePath);
  }
  function recordDecision({ decision = {}, data = {}, audit = {}, context = {} } = {}) {
    const stateFingerprint = createStateFingerprint({ data, decision, context });
    const familiarityEvidence = assessFamiliarity(stateFingerprint, records);
    const lifecycle = assessSignalLifecycle({ snapshot: data, decision, now: Date.now() });
    const disagreement = assessDisagreement({ decision, context });
    const robustness = assessDecisionRobustness({ snapshot: data, decision });
    const ablation = runFeatureAblation({ snapshot: data, decision });
    const direction = decision.direction ?? 'WAIT';
    const executable = (direction === 'BUY' || direction === 'SELL') && !decision.blocked && decision.executable !== false;
    const record = {
      id: id(),
      createdAt: now(),
      strategyVersion: version(context.strategyVersion ?? decision.strategyVersion ?? process.env.WILL_STRATEGY_VERSION, 'will-core-v1'),
      modelVersion: version(context.modelVersion ?? decision.modelVersion, 'deterministic-v1'),
      signalTimestamp: decision.generatedAt ?? data.timestamp ?? null,
      asset: data.asset ?? decision.asset ?? audit.asset ?? null,
      timeframe: data.timeframe ?? decision.timeframe ?? null,
      entryPrice: Number(data.price ?? decision.price) || null,
      direction,
      status: executable ? 'OPEN' : 'SKIPPED',
      score: Number(decision.score) || 0,
      confidence: Number(decision.confidence) || 0,
      regime: decision.regime ?? null,
      setup: decision.setup ?? null,
      setupType: decision.setupType ?? decision.setup ?? null,
      setupDirection: decision.setupDirection ?? null,
      setupQuality: decision.setupQuality ?? null,
      featureVersion: decision.featureVersion ?? data.featureVersion ?? 'legacy-unversioned',
      timingStatus: decision.timingStatus ?? null,
      entryQuality: Number.isFinite(Number(decision.entryQuality)) ? Number(decision.entryQuality) : null,
      timingVersion: decision.timingVersion ?? null,
      confirmations: Number(data.confirmations ?? decision.confirmations) || 0,
      clickTime: executable ? (decision.clickTime ?? null) : null,
      execution: executable ? { status: 'PENDING_CONFIRMATION', plannedClickTime: decision.clickTime ?? null, actualClickTime: null, actualEntryPrice: null, confirmedAt: null } : null,
      outcome: null,
      metadata: {
        blockReasons: Array.isArray(decision.blockReasons) ? [...decision.blockReasons] : [],
        dataQuality: dataQuality(data, context),
        provenance: provenance(data, context),
        featureSnapshot: structuredClone(featureSnapshot(data, decision)),
        setup: {
          evidence: Array.isArray(decision.setupEvidence) ? [...decision.setupEvidence] : [],
          invalidation: Array.isArray(decision.setupInvalidation) ? [...decision.setupInvalidation] : []
        },
        timing: { reasons: Array.isArray(decision.timingReasons) ? [...decision.timingReasons] : [], validFrom: decision.validFrom ?? null, validUntil: decision.validUntil ?? null },
        context: {
          expirySeconds: context.expirySeconds ?? null,
          requiredBars: Number.isFinite(Number(context.requiredBars)) ? Number(context.requiredBars) : null,
          decisionLatencyMs: Number.isFinite(Number(context.decisionLatencyMs)) ? Number(context.decisionLatencyMs) : null
        },
        marketContext: context.marketContext ? structuredClone(context.marketContext) : null
        ,stateFingerprint, familiarityEvidence
        ,lifecycle
        ,disagreement
        ,robustness
        ,ablation
      }
    };
    records.push(record);
    persist();
    return structuredClone(record);
  }
  function settle(idValue, outcome, metadata = {}) {
    if (!OUTCOMES.has(outcome)) throw new Error('Outcome inválido.');
    const index = records.findIndex((record) => record.id === idValue);
    if (index < 0) throw new Error('Sinal não encontrado.');
    if (records[index].status === 'CLOSED' && records[index].outcome === outcome) return { ...structuredClone(records[index]), idempotent: true };
    if (records[index].status !== 'OPEN') throw new Error('Somente sinais abertos podem receber outcome.');
    if (records[index].outcome) throw new Error('Outcome já registrado.');
    const settled = { ...records[index], status: 'CLOSED', outcome, exitPrice: Number(metadata.exitPrice) || null, settledAt: now(), outcomeMetadata: metadata };
    records[index] = { ...settled, errorAttribution: attributeOutcome(settled) };
    persist();
    return structuredClone(records[index]);
  }
  function confirmExecution(idValue, { actualClickTime, actualEntryPrice = null, notes = null } = {}) {
    const index = records.findIndex((record) => record.id === idValue);
    if (index < 0) throw new Error('Sinal não encontrado.');
    if (records[index].status !== 'OPEN') throw new Error('Somente sinais abertos podem confirmar execução.');
    const clickMs = Date.parse(actualClickTime ?? '');
    if (!Number.isFinite(clickMs)) throw new Error('Horário real do clique inválido.');
    const entryPrice = actualEntryPrice == null || actualEntryPrice === '' ? null : Number(actualEntryPrice);
    if (entryPrice !== null && (!Number.isFinite(entryPrice) || entryPrice <= 0)) throw new Error('Preço real de entrada inválido.');
    records[index] = {
      ...records[index],
      execution: {
        ...(records[index].execution ?? { plannedClickTime: records[index].clickTime ?? null }),
        status: 'CONFIRMED',
        actualClickTime: new Date(clickMs).toISOString(),
        actualEntryPrice: entryPrice,
        confirmedAt: now(),
        notes: typeof notes === 'string' ? notes.slice(0, 500) : null
      }
    };
    persist();
    return structuredClone(records[index]);
  }
  return { recordDecision, settle, confirmExecution, list: () => records.map((record) => structuredClone(record)) };
}
