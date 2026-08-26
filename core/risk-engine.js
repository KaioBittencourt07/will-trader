export function approve(signal, state = {}) {
  const reasons = [];
  const dailyLoss = Number(state.dailyLoss || 0);
  const dailyLossLimit = Number(state.dailyLossLimit || 0);
  const consecutiveLosses = Number(state.consecutiveLosses || 0);
  const confidence = Number(signal.confidence || 0);
  const score = Number(signal.score || 0);
  const grade = signal.grade || "C";

  if (state.mode !== "DEMO") reasons.push("Modo diferente de DEMO bloqueado.");
  if (!state.feedHealthy) reasons.push("Feed sem confirmação.");
  if (dailyLossLimit > 0 && dailyLoss >= dailyLossLimit) reasons.push("Limite diário atingido.");
  if (consecutiveLosses >= 3) reasons.push("Circuit breaker: três perdas seguidas.");
  if (signal.decision === "AGUARDAR") reasons.push("O sinal não tem vantagem suficiente.");
  if (confidence < 70) reasons.push("Confiança abaixo de 70%.");
  if (score < 30) reasons.push("Score de confluência abaixo de 30.");
  if (grade === "C") reasons.push("Qualidade do sinal insuficiente.");

  return { approved: reasons.length === 0, reasons };
}
