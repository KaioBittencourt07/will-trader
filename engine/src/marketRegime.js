export const REGIMES = Object.freeze({
  UP: 'TREND_UP',
  DOWN: 'TREND_DOWN',
  RANGE: 'RANGE',
  HIGH_VOL: 'HIGH_VOLATILITY',
  LOW_VOL: 'LOW_VOLATILITY',
  TRANSITION: 'TRANSITION',
  UNKNOWN: 'UNKNOWN'
});

export function classifyRegime(data) {
  const trend = Number(data?.trend);
  const volatility = Number(data?.volatility);
  const structure = Number(data?.structure);

  if (![trend, volatility, structure].every(Number.isFinite)) {
    return { regime: REGIMES.UNKNOWN, confidence: 0, reason: 'Dados insuficientes para classificar regime.' };
  }

  if (volatility >= 0.85) return { regime: REGIMES.HIGH_VOL, confidence: 90, reason: 'Volatilidade extrema detectada.' };
  if (volatility <= 0.15) return { regime: REGIMES.LOW_VOL, confidence: 75, reason: 'Volatilidade muito baixa.' };

  const directional = (trend * 0.6) + (structure * 0.4);
  if (directional >= 0.45) return { regime: REGIMES.UP, confidence: Math.min(95, Math.round(55 + directional * 40)), reason: 'Estrutura e tendência favorecem alta.' };
  if (directional <= -0.45) return { regime: REGIMES.DOWN, confidence: Math.min(95, Math.round(55 + Math.abs(directional) * 40)), reason: 'Estrutura e tendência favorecem baixa.' };
  if (Math.abs(directional) <= 0.15) return { regime: REGIMES.RANGE, confidence: 70, reason: 'Ausência de direção dominante.' };
  return { regime: REGIMES.TRANSITION, confidence: 55, reason: 'Sinais mistos sugerem transição de regime.' };
}
