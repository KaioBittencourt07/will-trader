export const PROSPECTIVE_MANIFEST_VERSION = 'prospective-paper-manifest-v1';
export const PROSPECTIVE_RECORD_VERSION = 'prospective-evidence-record-v1';

export const CHAMPION_FREEZE = Object.freeze({
  strategyVersion: 'will-core-v1',
  modelVersion: 'deterministic-v1',
  featureVersion: 'candle-price-action-v2',
  regimeVersion: 'market-regime-v2',
  timingVersion: 'entry-timing-v2',
  thresholds: Object.freeze({ minimumScore: 70, minimumConfidence: 70 }),
  rankingContract: 'opportunity-ranking-contract-v1',
  scannerContract: 'scanner-discovery-contract-v1',
  outcomeDefinition: 'prospective-expiry-reference-price-v1',
  dataQualityContract: 'data-quality-fail-closed-v1'
});

function clone(value) { return structuredClone(value); }
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function normalizedVersion(value, fallback) {
  const text = String(value ?? fallback).trim();
  return text || fallback;
}

/** A versioned protocol, not a statement that any sample size proves edge. */
export function createProspectiveManifest({ experimentId = 'prospective-paper-champion-v1', startTime = '2026-09-03T02:15:00.000Z', champion = CHAMPION_FREEZE } = {}) {
  const frozenChampion = freeze(clone(champion));
  return freeze({
    manifestVersion: PROSPECTIVE_MANIFEST_VERSION,
    experimentId,
    mode: 'PAPER',
    executionMode: 'MANUAL',
    status: 'RUNNING_PAPER',
    startTime,
    champion: frozenChampion,
    targetEvidencePolicy: {
      kind: 'NO_PREDECLARED_EDGE_N',
      statement: 'A sample count alone does not prove edge; interpretation requires temporal and out-of-sample review.'
    },
    primaryMetrics: ['decisionN', 'coverage', 'waitRate', 'WIN_LOSS_TIE_DATA_INVALID', 'wilsonInterval95'],
    secondaryMetrics: ['asset', 'setup', 'regime', 'timeframe', 'sessionHour', 'dataQualityProvider', 'timing', 'familiarity', 'disagreement', 'robustness', 'drift'],
    outcomeRules: ['RESOLVE_ONLY_ON_OR_AFTER_EXPIRY', 'REFERENCE_TIMESTAMP_MUST_NOT_PRECEDE_EXPIRY', 'DATA_INVALID_IS_NOT_WIN_OR_LOSS'],
    exclusions: ['INVALID_OR_STALE_RESOLUTION_DATA', 'UNVERIFIED_PROVIDER_OR_CLOCK_FAILURE'],
    stopSafetyCriteria: ['PROVIDER_DEGRADED', 'STORAGE_FAILURE', 'CLOCK_FAILURE', 'DATA_INVALID'],
    forbiddenMidBatchChanges: ['THRESHOLD_CHANGE', 'RANKING_CHANGE', 'CHAMPION_CHANGE', 'AUTO_TUNING', 'AUTO_PROMOTION', 'META_MODEL_TRAINING', 'PROBABILITY_CALIBRATION', 'RETROSPECTIVE_CHERRY_PICKING'],
    payoutAndCosts: { status: 'NOT_AVAILABLE', rule: 'No EV or expectancy is calculated without valid recorded payout and costs.' }
  });
}

export function assertChampionFrozen(manifest, versions = {}) {
  const champion = manifest?.champion;
  if (!champion) throw new Error('Manifesto prospectivo sem Champion congelado.');
  const fields = ['strategyVersion', 'modelVersion', 'featureVersion', 'regimeVersion', 'timingVersion'];
  const mismatches = fields.filter((field) => versions[field] != null && versions[field] !== champion[field]);
  if (mismatches.length) throw new Error(`Champion congelado divergente: ${mismatches.join(', ')}.`);
  return true;
}

/** Captures an append-only decision envelope; it cannot send an order or calculate EV. */
export function createProspectiveEvidenceRecord({ decision = {}, data = {}, context = {}, audit = {}, manifest = null, decisionId = null } = {}) {
  const activeManifest = manifest ?? createProspectiveManifest();
  const direction = ['BUY', 'SELL', 'WAIT'].includes(decision.direction) ? decision.direction : 'WAIT';
  const versions = {
    strategyVersion: normalizedVersion(context.strategyVersion ?? decision.strategyVersion, CHAMPION_FREEZE.strategyVersion),
    modelVersion: normalizedVersion(context.modelVersion ?? decision.modelVersion, CHAMPION_FREEZE.modelVersion),
    featureVersion: normalizedVersion(decision.featureVersion ?? data.featureVersion, CHAMPION_FREEZE.featureVersion),
    regimeVersion: normalizedVersion(decision.regimeVersion, CHAMPION_FREEZE.regimeVersion),
    timingVersion: normalizedVersion(decision.timingVersion, CHAMPION_FREEZE.timingVersion)
  };
  // Historical records remain readable. The no-mixing guard is enforced only
  // for a live prospective batch that explicitly supplies its manifest.
  if (manifest) assertChampionFrozen(activeManifest, versions);
  const executable = (direction === 'BUY' || direction === 'SELL') && decision.executable === true && decision.blocked !== true;
  const quality = {
    valid: data.valid !== false,
    status: data.status ?? 'UNKNOWN',
    provider: data.provider ?? data.source ?? 'UNKNOWN',
    ageMs: Number.isFinite(Number(data.ageMs)) ? Number(data.ageMs) : null,
    timestamp: data.timestamp ?? null
  };
  return freeze({
    recordVersion: PROSPECTIVE_RECORD_VERSION,
    experimentId: activeManifest.experimentId,
    decisionId: decisionId ?? audit.id ?? null,
    decisionTime: decision.generatedAt ?? data.timestamp ?? audit.createdAt ?? null,
    decision: direction,
    disposition: executable ? (context.rankingSelected === true ? 'SELECTED' : 'EXECUTABLE_UNSELECTED') : 'REJECTED',
    asset: data.asset ?? decision.asset ?? audit.asset ?? null,
    timeframe: data.timeframe ?? decision.timeframe ?? null,
    recommendedClickTime: decision.clickTime ?? null,
    validFrom: decision.validFrom ?? decision.timing?.validFrom ?? null,
    validUntil: decision.validUntil ?? decision.timing?.validUntil ?? null,
    recommendedEntryPrice: Number.isFinite(Number(data.price ?? decision.price)) ? Number(data.price ?? decision.price) : null,
    setup: decision.setup ?? null,
    regime: decision.regime ?? null,
    timing: { status: decision.timingStatus ?? null, reasons: [...(decision.timingReasons ?? [])] },
    mtf: clone(context.mtfContext ?? { status: 'NOT_AVAILABLE' }),
    familiarity: clone(context.familiarity ?? { status: 'NOT_AVAILABLE' }),
    lifecycle: clone(context.lifecycle ?? { status: 'NOT_AVAILABLE' }),
    disagreement: clone(context.disagreement ?? { status: 'NOT_AVAILABLE' }),
    robustness: clone(context.robustness ?? { status: 'NOT_AVAILABLE' }),
    drift: clone(context.drift ?? { status: 'NOT_AVAILABLE' }),
    dataQuality: quality,
    providerState: context.providerHealth ?? data.providerHealth ?? 'UNKNOWN',
    versions,
    executionQuality: {
      actualClickTime: null,
      actualEntryPrice: null,
      executionDelayMs: null,
      signalExpiry: decision.validUntil ?? decision.timing?.validUntil ?? null
    },
    outcome: { status: 'PENDING', payoutAndCosts: 'NOT_AVAILABLE' }
  });
}

export function evAvailability({ payout = null, costs = null } = {}) {
  return payout != null && costs != null && Number.isFinite(Number(payout)) && Number.isFinite(Number(costs))
    ? { status: 'AVAILABLE_FOR_FUTURE_ANALYSIS' }
    : { status: 'NOT_AVAILABLE', reason: 'VALID_PAYOUT_AND_COSTS_REQUIRED' };
}

