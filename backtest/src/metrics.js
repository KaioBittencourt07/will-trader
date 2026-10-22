/**
 * Legacy unit-outcome summary. Without an explicit payout this is a +1/-1
 * outcome score, NOT real binary-option PnL or a claim of financial expectancy.
 * Use runHistoricalReplay from marketValidation.js for timestamp-aware replay.
 */
export function calculateMetrics(records = [], {
  payoutRatio = null,
  stake = 1,
  costPerTrade = 0
} = {}) {
  if (!Array.isArray(records)) throw new TypeError('METRICS_RECORDS_MUST_BE_AN_ARRAY');
  if (payoutRatio !== null && (!Number.isFinite(payoutRatio) || payoutRatio <= 0 || payoutRatio > 10)) {
    throw new Error('INVALID_PAYOUT_RATIO');
  }
  if (!Number.isFinite(stake) || stake <= 0) throw new Error('INVALID_STAKE');
  if (!Number.isFinite(costPerTrade) || costPerTrade < 0) throw new Error('INVALID_COST_PER_TRADE');

  const settled = records.filter((r) => ['WIN', 'LOSS', 'TIE'].includes(r?.outcome));
  const decisive = settled.filter((r) => r.outcome === 'WIN' || r.outcome === 'LOSS');
  const wins = decisive.filter((r) => r.outcome === 'WIN').length;
  const losses = decisive.length - wins;
  const ties = settled.length - decisive.length;
  const winRate = decisive.length ? wins / decisive.length : null;

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let streak = 0;
  let maxLossStreak = 0;

  for (const record of decisive) {
    const result = record.outcome === 'WIN' ? 1 : -1;
    equity += result;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    streak = result < 0 ? streak + 1 : 0;
    maxLossStreak = Math.max(maxLossStreak, streak);
  }

  const netPnl = payoutRatio === null ? null : settled.reduce((sum, record) => {
    if (record.outcome === 'WIN') return sum + stake * payoutRatio - costPerTrade;
    if (record.outcome === 'LOSS') return sum - stake - costPerTrade;
    return sum - costPerTrade;
  }, 0);

  return {
    sampleSize: decisive.length,
    wins,
    losses,
    ties,
    winRate,
    // Backward-compatible fields: these assume +1 unit per WIN and -1 per LOSS.
    netUnits: equity,
    maxDrawdownUnits: maxDrawdown,
    maxLossStreak,
    expectancyUnits: decisive.length ? equity / decisive.length : null,
    metricSemantics: 'LEGACY_PLUS_ONE_MINUS_ONE_OUTCOME_SCORE_NOT_CASH_PNL',
    payoutRatio,
    stake,
    costPerTrade,
    settledSampleSize: settled.length,
    netPnl,
    financialExpectancyPerSettledTrade: payoutRatio === null || settled.length === 0 ? null : netPnl / settled.length,
    breakEvenWinRateWithoutTies: payoutRatio === null ? null : (stake + costPerTrade) / (stake * (1 + payoutRatio)),
    financialMetricsStatus: payoutRatio === null
      ? 'PAYOUT_RATIO_REQUIRED'
      : settled.length === 0
        ? 'NO_SETTLED_TRADES'
        : 'COMPUTED_ON_SUPPLIED_OUTCOMES_NOT_EDGE_PROOF',
    edgeProven: false
  };
}
