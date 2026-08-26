export function approve(signal, state) {
  const reasons = [];
  if (state.mode !== "DEMO") reasons.push("Modo diferente de DEMO bloqueado.");
  if (!state.feedHealthy) reasons.push("Feed sem confirmação.");
  if (state.dailyLoss >= state.dailyLossLimit) reasons.push("Limite diário atingido.");
  if (state.consecutiveLosses >= 3) reasons.push("Circuit breaker: três perdas seguidas.");
  if (signal.decision === "AGUARDAR") reasons.push("O sinal não tem vantagem suficiente.");
  return { approved: reasons.length === 0, reasons };
}
