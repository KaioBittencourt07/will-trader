import { classifyRegime } from './marketRegime.js';
import { classifySetup } from './setupClassifier.js';
import { decide } from './willEngine.js';
import { calibrateConfidence } from './confidence.js';
import { evaluateNoTrade } from './noTrade.js';

export function willCore(market, context = {}) {
  const decision = decide(market);
  const regime = classifyRegime(market);
  const setup = classifySetup(market, regime.regime);

  /*
   * A confiança representa a qualidade da evidência.
   * Ela NÃO deve virar zero apenas porque a decisão técnica
   * ainda está bloqueada.
   */
  const calibrated = calibrateConfidence({
    technical: decision.score,
    regime: regime.confidence,
    setup: setup.confidence,
    sampleSize: context.sampleSize ?? market.candleCount ?? 0,
    blocked: false
  });

  const noTrade = evaluateNoTrade({
    regime: regime.regime,
    setup: setup.setup,
    volatility: market.volatility,
    confidence: calibrated,
    macroBlocked: Boolean(
      context.macroBlocked || context.newsBlocked
    ),
    dataValid: context.dataValid !== false,
    minimumConfidence: context.minimumConfidence ?? 70
  });

  const blocked = decision.blocked || noTrade.blocked;

  /*
   * Mantemos a direção técnica para o dashboard,
   * mesmo quando a entrada está bloqueada.
   *
   * Assim:
   * SELL + blocked=true
   * é diferente de
   * WAIT porque não existe direção.
   */
  const direction =
    decision.direction === 'WAIT'
      ? 'WAIT'
      : decision.direction;

  return {
    asset: market.asset,
    timestamp: market.timestamp,
    timeframe: market.timeframe,

    direction,

    score: decision.score,
    confidence: calibrated,
    // Keep the raw evidence visible to the selector, audit log and history.
    // Confidence is a summary; it must never hide how many independent
    // technical confirmations supported the signal.
    confirmations: decision.confirmations,

    regime: regime.regime,
    regimeConfidence: regime.confidence,
    regimeType: regime.regimeType,
    regimeStrength: regime.regimeStrength,
    regimeStability: regime.regimeStability,
    transitionRisk: regime.transitionRisk,
    regimeEvidence: regime.regimeEvidence,
    regimeVersion: regime.regimeVersion,

    setup: setup.setup,
    setupConfidence: setup.confidence,
    setupType: setup.setupType,
    setupDirection: setup.setupDirection,
    setupQuality: setup.setupQuality,
    setupEvidence: setup.evidence,
    setupInvalidation: setup.invalidation,
    featureVersion: setup.featureVersion,

    blocked,

    blockReasons: [
      ...(decision.riskFlags ?? []),
      ...noTrade.reasons
    ],

    macroBlocked: Boolean(context.macroBlocked),
    newsBlocked: Boolean(context.newsBlocked),

    reason: blocked
      ? 'Entrada bloqueada pelo No-Trade Engine.'
      : decision.reason
  };
}
