import { classifyRegime } from './marketRegime.js';
import { classifySetup } from './setupClassifier.js';
import { decide } from './willEngine.js';
import { calibrateConfidence } from './confidence.js';
import { evaluateNoTrade } from './noTrade.js';

export function willCore(market, context = {}) {
  const decision = decide(market);
  const regime = classifyRegime(market);
  const setup = classifySetup(market, regime.regime);
  const calibrated = calibrateConfidence({ technical: decision.score, regime: regime.confidence, setup: setup.confidence, sampleSize: context.sampleSize ?? 0, blocked: decision.blocked });
  const noTrade = evaluateNoTrade({ regime: regime.regime, setup: setup.setup, volatility: market.volatility, confidence: calibrated, macroBlocked: Boolean(context.macroBlocked || context.newsBlocked), dataValid: context.dataValid !== false, minimumConfidence: context.minimumConfidence ?? 70 });
  const blocked = decision.blocked || noTrade.blocked;
  return {
    asset: market.asset,
    timestamp: market.timestamp,
    timeframe: market.timeframe,
    direction: blocked ? 'WAIT' : decision.direction,
    score: decision.score,
    confidence: blocked ? 0 : calibrated,
    regime: regime.regime,
    regimeConfidence: regime.confidence,
    setup: setup.setup,
    setupConfidence: setup.confidence,
    blocked,
    blockReasons: [...(decision.riskFlags ?? []), ...noTrade.reasons],
    macroBlocked: Boolean(context.macroBlocked),
    newsBlocked: Boolean(context.newsBlocked),
    reason: blocked ? 'No-Trade Engine bloqueou a entrada.' : decision.reason
  };
}
