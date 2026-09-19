export function resolveOutcome(record, outcome, metadata = {}) {
  if (!['WIN', 'LOSS', 'VOID'].includes(outcome)) throw new Error('Outcome inválido.');
  return { ...record, outcome, resolvedAt: new Date().toISOString(), result: metadata.result ?? null, payout: metadata.payout ?? record.payout ?? null, errorTag: metadata.errorTag ?? record.errorTag ?? null };
}

export function buildLearningSignal(record) {
  if (!record || !['WIN', 'LOSS'].includes(record.outcome)) return null;
  return {
    asset: record.asset,
    regime: record.regime,
    setup: record.setup,
    timeframe: record.timeframe,
    direction: record.direction,
    outcome: record.outcome,
    confidence: record.confidence,
    errorTag: record.errorTag ?? null
  };
}
