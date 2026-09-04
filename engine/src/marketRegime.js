export const REGIMES = Object.freeze({
  UP: 'TREND_UP',
  DOWN: 'TREND_DOWN',
  RANGE: 'RANGE',
  HIGH_VOL: 'HIGH_VOLATILITY',
  LOW_VOL: 'LOW_VOLATILITY',
  TRANSITION: 'TRANSITION',
  UNKNOWN: 'UNKNOWN'
});
export const REGIME_VERSION = 'market-regime-v2';

function describe(regime, confidence, reason, data = {}) {
  const type = regime === REGIMES.UP || regime === REGIMES.DOWN ? 'TREND' : regime === REGIMES.HIGH_VOL ? 'CHAOTIC_HIGH_VOL' : regime === REGIMES.LOW_VOL ? 'COMPRESSION' : regime;
  const transitionRisk = type === 'TRANSITION' || type === 'CHAOTIC_HIGH_VOL' ? 'HIGH' : type === 'UNKNOWN' ? 'UNKNOWN' : 'LOW';
  return { regime, confidence, reason, regimeType: type, regimeStrength: confidence, regimeStability: Math.max(0, 100 - (Number(data.volatility ?? 0) * 45) - (type === 'TRANSITION' ? 30 : 0)), transitionRisk, regimeEvidence: [reason], regimeVersion: REGIME_VERSION };
}

export function classifyRegime(data) {
  const trend = Number(data?.trend);
  const volatility = Number(data?.volatility);
  const structure = Number(data?.structure);

  if (![trend, volatility, structure].every(Number.isFinite)) {
    return describe(REGIMES.UNKNOWN, 0, 'Dados insuficientes para classificar regime.', data);
  }

  if (volatility >= 0.85) return describe(REGIMES.HIGH_VOL, 90, 'Volatilidade extrema detectada.', data);
  if (volatility <= 0.15) return describe(REGIMES.LOW_VOL, 75, 'Volatilidade muito baixa.', data);

  const directional = (trend * 0.6) + (structure * 0.4);
  if (directional >= 0.45) return describe(REGIMES.UP, Math.min(95, Math.round(55 + directional * 40)), 'Estrutura e tendência favorecem alta.', data);
  if (directional <= -0.45) return describe(REGIMES.DOWN, Math.min(95, Math.round(55 + Math.abs(directional) * 40)), 'Estrutura e tendência favorecem baixa.', data);
  if (Math.abs(directional) <= 0.15) return describe(REGIMES.RANGE, 70, 'Ausência de direção dominante.', data);
  return describe(REGIMES.TRANSITION, 55, 'Sinais mistos sugerem transição de regime.', data);
}
