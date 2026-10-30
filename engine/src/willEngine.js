const DIRECTIONS = Object.freeze({ BUY: 'BUY', SELL: 'SELL', WAIT: 'WAIT' });

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function validateMarketData(data) {
  const required = ['asset', 'timestamp', 'price', 'timeframe'];
  const missing = required.filter((key) => data?.[key] === undefined || data?.[key] === null || data?.[key] === '');
  if (missing.length) return { ok: false, reason: `Dados ausentes: ${missing.join(', ')}` };
  if (!Number.isFinite(Number(data.price)) || Number(data.price) <= 0) {
    return { ok: false, reason: 'Preço inválido.' };
  }
  const timestamp = Date.parse(data.timestamp);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: 'Timestamp inválido.' };
  const ageMs = Date.now() - timestamp;
  if (ageMs < -60_000) return { ok: false, reason: 'Timestamp futuro/inconsistente.' };
  if (ageMs > 120_000) return { ok: false, reason: 'Dados atrasados.' };
  return { ok: true };
}

function analyzeTechnical(data) {
  const trend = Number(data.trend ?? 0);          // -1 .. 1
  const momentum = Number(data.momentum ?? 0);    // -1 .. 1
  const structure = Number(data.structure ?? 0);  // -1 .. 1
  const volatility = Number(data.volatility ?? 0.5); // 0 .. 1
  const confirmations = Number(data.confirmations ?? 0);

  const directional = trend * 0.35 + momentum * 0.30 + structure * 0.35;
  const volatilityPenalty = volatility > 0.85 ? 25 : volatility > 0.70 ? 10 : 0;
  const confirmationBonus = clamp(confirmations, 0, 7) * 3;
  let score = Math.round(50 + Math.abs(directional) * 45 + confirmationBonus - volatilityPenalty);
  score = clamp(score, 0, 100);

  const direction = directional > 0.15 ? DIRECTIONS.BUY : directional < -0.15 ? DIRECTIONS.SELL : DIRECTIONS.WAIT;
  const riskFlags = [];
  if (volatility > 0.85) riskFlags.push('volatilidade extrema');
  if (confirmations < 3) riskFlags.push('poucas confirmações');
  if (Math.abs(directional) < 0.15) riskFlags.push('direção indefinida');

  return { direction, score, confirmations, riskFlags };
}

export function decide(data) {
  const guard = validateMarketData(data);
  if (!guard.ok) {
    return {
      asset: data?.asset ?? null,
      direction: DIRECTIONS.WAIT,
      score: 0,
      confidence: 0,
      blocked: true,
      reason: `DATA GUARD: ${guard.reason}`,
      riskFlags: [guard.reason]
    };
  }

  const technical = analyzeTechnical(data);
  const minimumScore = Number(data.minimumScore ?? 70);
  const blocked = technical.direction === DIRECTIONS.WAIT || technical.score < minimumScore || technical.riskFlags.includes('volatilidade extrema');

  return {
    asset: data.asset,
    timestamp: data.timestamp,
    timeframe: data.timeframe,
    direction: blocked ? DIRECTIONS.WAIT : technical.direction,
    score: technical.score,
    confidence: blocked ? Math.min(technical.score, 55) : clamp(technical.score - 5, 0, 95),
    confirmations: technical.confirmations,
    blocked,
    reason: blocked ? 'Condições insuficientes para liberar entrada.' : 'Confluência técnica atingiu o limiar configurado.',
    riskFlags: technical.riskFlags
  };
}
