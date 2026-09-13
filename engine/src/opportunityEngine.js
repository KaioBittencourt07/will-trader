function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Ranking is deliberately separate from the entry rules.  It does not turn a
 * WAIT into a trade and it does not lower a threshold; it only chooses the
 * most evidenced entry among the ones the deterministic engine already
 * released.
 */
function rankOpportunity(item = {}) {
  const decision = item.decision ?? {};
  const snapshot = item.snapshot ?? {};
  const confirmations = clamp(Number(decision.confirmations ?? snapshot.confirmations ?? 0), 0, 4);
  const ageMs = Number(snapshot.ageMs);
  const freshness = Number.isFinite(ageMs) ? clamp(100 - (ageMs / 30_000) * 100, 0, 100) : 100;
  const quality = Math.round(
    Number(decision.confidence ?? 0) * 0.45
    + Number(decision.score ?? 0) * 0.25
    + (confirmations / 4) * 100 * 0.15
    + Number(decision.regimeConfidence ?? 0) * 0.075
    + Number(decision.setupConfidence ?? 0) * 0.075
    + freshness * 0.05
  );
  return {
    quality,
    confirmations,
    freshness: Math.round(freshness),
    components: {
      confidence: Number(decision.confidence ?? 0),
      score: Number(decision.score ?? 0),
      regimeConfidence: Number(decision.regimeConfidence ?? 0),
      setupConfidence: Number(decision.setupConfidence ?? 0)
    }
  };
}

export function selectBestOpportunity(analyses = []) {
  const executable = analyses.filter((item) => item?.decision?.executable && !item.decision.blocked && ['BUY', 'SELL'].includes(item.decision.direction));
  if (!executable.length) return { recommendation: null, reason: 'Nenhum ativo atingiu os critérios de entrada. WAIT é a decisão correta.' };
  const ranked = executable
    .map((item) => ({ ...item, ranking: rankOpportunity(item) }))
    .sort((a, b) => b.ranking.quality - a.ranking.quality || b.ranking.confirmations - a.ranking.confirmations || a.asset.localeCompare(b.asset));
  return {
    recommendation: ranked[0],
    reason: 'Ativo com maior qualidade de evidência entre os sinais já executáveis.'
  };
}
