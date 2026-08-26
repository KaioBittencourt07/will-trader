export const DECISIONS = Object.freeze({ BUY: "COMPRA", SELL: "VENDA", WAIT: "AGUARDAR" });

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

export function analyse(snapshot) {
  const { trend, momentum, structure, volatility, payout = 80, feedHealthy = true } = snapshot;
  const buy = clamp((trend + momentum + structure + (100 - volatility)) / 4);
  const sell = clamp(100 - buy);
  const edge = Math.abs(buy - sell);
  const breakEven = 100 / (1 + payout / 100);
  const probability = Math.max(buy, sell);
  const enoughEdge = probability >= breakEven + 4 && edge >= 18;

  if (!feedHealthy || !enoughEdge) {
    return { decision: DECISIONS.WAIT, buy, sell, confidence: 0, score: 0,
      rationale: !feedHealthy ? "Feed indisponível ou inconsistente: operação bloqueada." : "Sem vantagem estatística suficiente após o payout." };
  }
  const decision = buy > sell ? DECISIONS.BUY : DECISIONS.SELL;
  return { decision, buy, sell, confidence: Math.round(probability), score: Math.round(edge),
    rationale: "Consenso de tendência, momentum e estrutura passou pelos filtros de payout e risco." };
}
