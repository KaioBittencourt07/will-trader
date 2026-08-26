export const WIL_FACTORS = Object.freeze([
  "forcaMercado",
  "pressao",
  "estrutura",
  "liquidezSweep",
  "velaForca",
  "exaustao",
  "limitePreco",
  "novaAltaBaixa",
  "reversaoConfirmada",
  "gap",
]);

const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, Number(v) || 0));

/**
 * Camada de leitura baseada nos conceitos públicos do treinamento do Wil Trader.
 * Não replica indicadores proprietários nem afirma prever o mercado.
 * Recebe leitura humana/externa normalizada em 0..100.
 */
export function buildPriceActionScore(input = {}) {
  const x = Object.fromEntries(WIL_FACTORS.map(k => [k, clamp(input[k], 50)]));
  const bull = [x.forcaMercado, x.pressao, x.estrutura, x.velaForca, x.novaAltaBaixa, x.limitePreco];
  const bear = bull.map(v => 100 - v);
  const confirmation = x.reversaoConfirmada >= 60 ? 1 : 0;
  const liquidityQuality = x.liquidezSweep >= 45 && x.liquidezSweep <= 80 ? 1 : 0;
  const exhaustionPenalty = x.exaustao >= 80 ? 12 : 0;
  const gapPenalty = x.gap >= 85 ? 8 : 0;

  const buy = clamp(bull.reduce((a, b) => a + b, 0) / bull.length - exhaustionPenalty - gapPenalty);
  const sell = clamp(bear.reduce((a, b) => a + b, 0) / bear.length - exhaustionPenalty - gapPenalty);
  const edge = Math.abs(buy - sell);
  const confirmations = [
    x.forcaMercado >= 60,
    x.pressao >= 60,
    x.estrutura >= 60,
    x.velaForca >= 60,
    x.novaAltaBaixa >= 60,
    Boolean(confirmation),
    Boolean(liquidityQuality),
  ].filter(Boolean).length;

  return {
    buy: Math.round(buy),
    sell: Math.round(sell),
    edge: Math.round(edge),
    confirmations,
    direction: buy >= sell ? "COMPRA" : "VENDA",
    blocked: x.exaustao >= 90 || x.gap >= 95,
  };
}
