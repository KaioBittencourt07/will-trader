import { willCore } from '../../engine/src/willCore.js';

export const REPLAY_CONTRACT_VERSION = 'decision-replay-v1';

export function snapshotFromEvidence(record = {}) {
  const quality = record.metadata?.dataQuality ?? {};
  const features = record.metadata?.featureSnapshot ?? {};
  return {
    asset: record.asset ?? null,
    timeframe: record.timeframe ?? null,
    timestamp: record.signalTimestamp ?? null,
    price: record.entryPrice ?? null,
    valid: quality.valid,
    status: quality.status,
    source: quality.source,
    quoteTimestamp: quality.quoteTimestamp,
    candleTimestamp: quality.candleTimestamp,
    ...features
  };
}

function mismatch(record, replayed) {
  const fields = ['direction', 'score', 'confidence', 'regime', 'setup', 'confirmations', 'blocked', 'setupType', 'setupDirection', 'setupQuality', 'featureVersion'];
  const reasons = fields.filter((field) => record[field] !== undefined && record[field] !== replayed[field]).map((field) => `REPLAY_${field.toUpperCase()}_MISMATCH`);
  return reasons;
}

/** Offline only: this module has no provider, filesystem or AI dependency. */
export function replayEvidence(record, { engine = willCore } = {}) {
  const snapshot = snapshotFromEvidence(record);
  const context = record.metadata?.context ?? {};
  const replayed = engine(snapshot, context);
  const reasons = mismatch(record, replayed);
  return {
    contractVersion: REPLAY_CONTRACT_VERSION,
    decisionId: record.id ?? null,
    strategyVersion: record.strategyVersion ?? null,
    modelVersion: record.modelVersion ?? null,
    featureVersion: record.featureVersion ?? snapshot.featureVersion ?? 'legacy-unversioned',
    match: reasons.length === 0,
    reasons,
    replayed
  };
}

export function replayEvidenceBatch(records = [], options = {}) {
  const results = records.map((record) => replayEvidence(record, options));
  const mismatches = results.filter((result) => !result.match);
  const byVersion = new Map();
  for (const result of results) {
    const key = `${result.strategyVersion ?? 'UNKNOWN'}|${result.modelVersion ?? 'UNKNOWN'}`;
    const item = byVersion.get(key) ?? { key, n: 0, mismatches: 0, reasonCodes: {} };
    item.n += 1;
    if (!result.match) {
      item.mismatches += 1;
      for (const reason of result.reasons) item.reasonCodes[reason] = (item.reasonCodes[reason] ?? 0) + 1;
    }
    byVersion.set(key, item);
  }
  return { contractVersion: REPLAY_CONTRACT_VERSION, n: results.length, mismatches: mismatches.length, byVersion: [...byVersion.values()], results };
}
