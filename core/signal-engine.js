export const DECISIONS = Object.freeze({ BUY: "COMPRA", SELL: "VENDA", WAIT: "AGUARDAR" });

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value) || 0));
const n = (value, fallback = 50) => clamp(value ?? fallback);

/**
 * Motor de sinal v2.
 * Espera métricas normalizadas de 0..100 e não envia ordens.
 * A ideia é reduzir entradas fracas: mais confluência, menos "chute".
 */
export function analyse(snapshot = {}) {
  const {
    trend,
    momentum,
    structure,
    volatility,
    volume = 50,
    candleQuality = 50,
    payout = 80,
    feedHealthy = true,
  } = snapshot;

  const t = n(trend);
  const m = n(momentum);
  const s = n(structure);
  const v = n(volatility);
  const vol = n(volume);
  const candle = n(candleQuality);
  const safePayout = clamp(payout, 0, 1000);

  // Volatilidade extrema aumenta ruído. Faixa intermediária recebe menor penalização.
  const volatilityPenalty = v > 65 ? Math.min(18, (v - 65) * 0.6) : 0;

  const bullishBase =
    t * 0.30 +
    m * 0.22 +
    s * 0.22 +
    vol * 0.12 +
    candle * 0.14;

  const bearishBase =
    (100 - t) * 0.30 +
    (100 - m) * 0.22 +
    (100 - s) * 0.22 +
    (100 - vol) * 0.12 +
    (100 - candle) * 0.14;

  const buy = clamp(bullishBase - volatilityPenalty);
  const sell = clamp(bearishBase - volatilityPenalty);
  const probability = Math.max(buy, sell);
  const edge = Math.abs(buy - sell);
  const breakEven = 100 / (1 + safePayout / 100);

  // Exige confirmação mínima em tendência, momentum e estrutura.
  const directional = buy >= sell;
  const factors = directional ? [t, m, s] : [100 - t, 100 - m, 100 - s];
  const confirmations = factors.filter(x => x >= 60).length;
  const enoughEdge = edge >= 24;
  const aboveBreakEven = probability >= breakEven + 6;
  const enoughConfirmation = confirmations >= 2;
  const acceptableVolatility = v <= 82;
  const validPayout = safePayout > 0;

  if (!feedHealthy) {
    return {
      decision: DECISIONS.WAIT,
      buy: Math.round(buy),
      sell: Math.round(sell),
      confidence: 0,
      score: 0,
      grade: "F",
      rationale: "Feed indisponível ou inconsistente: operação bloqueada.",
    };
  }

  if (!validPayout || !aboveBreakEven || !enoughEdge || !enoughConfirmation || !acceptableVolatility) {
    const reasons = [];
    if (!validPayout) reasons.push("payout inválido");
    if (!aboveBreakEven) reasons.push("vantagem abaixo do break-even");
    if (!enoughEdge) reasons.push("confluência direcional fraca");
    if (!enoughConfirmation) reasons.push("menos de 2 confirmações estruturais");
    if (!acceptableVolatility) reasons.push("volatilidade extrema");

    return {
      decision: DECISIONS.WAIT,
      buy: Math.round(buy),
      sell: Math.round(sell),
      confidence: Math.round(probability),
      score: Math.round(edge),
      grade: "C",
      rationale: `AGUARDAR: ${reasons.join("; ")}.`,
    };
  }

  const score = Math.round(Math.min(100, edge * 1.35 + (confirmations - 2) * 5));
  const grade = probability >= 75 && edge >= 35 ? "A" : "B";
  const decision = directional ? DECISIONS.BUY : DECISIONS.SELL;

  return {
    decision,
    buy: Math.round(buy),
    sell: Math.round(sell),
    confidence: Math.round(probability),
    score,
    grade,
    rationale: `${decision}: tendência, momentum e estrutura alinhados; ${confirmations}/3 confirmações. Break-even ${breakEven.toFixed(1)}% e payout ${safePayout}%.`,
  };
}
