export function systemHealth({ data = false, core = false, risk = false, macro = false, news = false, paper = false, memory = false, backtest = false, audit = false } = {}) {
  const checks = { data, core, risk, macro, news, paper, memory, backtest, audit };
  const values = Object.values(checks);
  const healthy = values.length > 0 && values.every(Boolean);
  return { healthy, checks, healthyCount: values.filter(Boolean).length, total: values.length };
}
