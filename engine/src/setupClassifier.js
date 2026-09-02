export const SETUPS = Object.freeze({
  CONTINUATION: 'CONTINUATION',
  PULLBACK: 'PULLBACK',
  BREAKOUT: 'BREAKOUT',
  REJECTION: 'REJECTION',
  REVERSAL: 'REVERSAL',
  STRUCTURE: 'STRUCTURE',
  TREND: 'TREND',
  RANGE: 'RANGE',
  UNKNOWN: 'UNKNOWN'
});

export function classifySetup(data, regime) {
  const trend = Number(data?.trend);
  const momentum = Number(data?.momentum);
  const structure = Number(data?.structure);

  const breakout = Boolean(data?.breakout);
  const rejection = Boolean(data?.rejection);
  const pullback = Boolean(data?.pullback);
  const reversal = Boolean(data?.reversal);

  if (![trend, momentum, structure].every(Number.isFinite)) {
    return {
      setup: SETUPS.UNKNOWN,
      confidence: 0,
      reason: 'Dados insuficientes para classificar setup.'
    };
  }

  if (reversal && Math.abs(structure) >= 0.35) {
    return {
      setup: SETUPS.REVERSAL,
      confidence: 80,
      reason: 'Mudança estrutural com sinal de reversão.'
    };
  }

  if (breakout && Math.abs(momentum) >= 0.35) {
    return {
      setup: SETUPS.BREAKOUT,
      confidence: 80,
      reason: 'Rompimento acompanhado de momentum.'
    };
  }

  if (rejection && Math.abs(structure) >= 0.25) {
    return {
      setup: SETUPS.REJECTION,
      confidence: 75,
      reason: 'Rejeição de região relevante com suporte estrutural.'
    };
  }

  if (pullback && Math.abs(trend) >= 0.45) {
    return {
      setup: SETUPS.PULLBACK,
      confidence: 78,
      reason: 'Correção dentro de contexto direcional.'
    };
  }

  if (regime === 'RANGE') {
    return {
      setup: SETUPS.RANGE,
      confidence: 65,
      reason: 'Mercado sem direção dominante.'
    };
  }

  if (
    Math.abs(trend) >= 0.55 &&
    Math.abs(momentum) >= 0.35 &&
    Math.sign(trend) === Math.sign(momentum)
  ) {
    return {
      setup: SETUPS.CONTINUATION,
      confidence: 78,
      reason: 'Tendência e momentum alinhados.'
    };
  }

  if (Math.abs(trend) >= 0.55) {
    return {
      setup: SETUPS.TREND,
      confidence: 68,
      reason: 'Tendência dominante identificada.'
    };
  }

  if (Math.abs(structure) >= 0.75) {
    return {
      setup: SETUPS.STRUCTURE,
      confidence: 65,
      reason: 'Estrutura de mercado forte, mas sem confirmação direcional suficiente.'
    };
  }

  return {
    setup: SETUPS.UNKNOWN,
    confidence: 40,
    reason: 'Nenhum setup validado.'
  };
}
