export function calculateMetrics(records = []) {
  const completed = records.filter((r) => r?.outcome === 'WIN' || r?.outcome === 'LOSS');
  const wins = completed.filter((r) => r.outcome === 'WIN').length;
  const losses = completed.length - wins;
  const winRate = completed.length ? wins / completed.length : null;

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let streak = 0;
  let maxLossStreak = 0;

  for (const record of completed) {
    const result = record.outcome === 'WIN' ? 1 : -1;
    equity += result;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    streak = result < 0 ? streak + 1 : 0;
    maxLossStreak = Math.max(maxLossStreak, streak);
  }

  return {
    sampleSize: completed.length,
    wins,
    losses,
    winRate,
    netUnits: equity,
    maxDrawdownUnits: maxDrawdown,
    maxLossStreak,
    expectancyUnits: completed.length ? equity / completed.length : null
  };
}
