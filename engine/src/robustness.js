import { willCore } from './willCore.js';

export const ROBUSTNESS_VERSION = 'decision-robustness-shadow-v1';
export const ROBUSTNESS = Object.freeze({ ROBUST: 'ROBUST', SENSITIVE: 'SENSITIVE', FRAGILE: 'FRAGILE', UNKNOWN: 'UNKNOWN' });

function clone(value) { return structuredClone(value); }
function comparable(decision = {}) { return { direction: decision.direction ?? 'WAIT', setup: decision.setup ?? 'UNKNOWN', blocked: Boolean(decision.blocked) }; }

/** Offline only. Perturbations are bounded descriptions, never future market data. */
export function assessDecisionRobustness({ snapshot = {}, decision = null, engine = willCore } = {}) {
  if (snapshot.valid === false || snapshot.status === 'STALE' || snapshot.price == null || !Number.isFinite(Number(snapshot.price)) || Number(snapshot.price) <= 0 || !snapshot.timestamp) {
    return { mode: 'SHADOW', robustnessVersion: ROBUSTNESS_VERSION, status: ROBUSTNESS.UNKNOWN, evidence: ['INSUFFICIENT_OR_STALE_EVIDENCE'], scenarios: [] };
  }
  const baseline = comparable(decision ?? engine(clone(snapshot), { dataValid: true }));
  const price = Number(snapshot.price);
  const scenarios = [
    { id: 'PRICE_MINUS_10BPS', patch: { price: price * .999 } },
    { id: 'PRICE_PLUS_10BPS', patch: { price: price * 1.001 } },
    { id: 'VOLATILITY_PLUS_003', patch: { volatility: Math.min(1, Number(snapshot.volatility ?? .5) + .03) } },
    { id: 'LATENCY_MARKER', patch: { simulatedLatencyMs: 250 } }
  ].map(({ id, patch }) => {
    const perturbed = { ...clone(snapshot), ...patch };
    const result = comparable(engine(perturbed, { dataValid: true }));
    return { id, result, stable: JSON.stringify(result) === JSON.stringify(baseline) };
  });
  const unstable = scenarios.filter((item) => !item.stable).length;
  const status = unstable === 0 ? ROBUSTNESS.ROBUST : unstable <= 2 ? ROBUSTNESS.SENSITIVE : ROBUSTNESS.FRAGILE;
  return { mode: 'SHADOW', robustnessVersion: ROBUSTNESS_VERSION, status, baseline, unstableScenarioCount: unstable, evidence: unstable ? ['OUTPUT_CHANGED_UNDER_BOUNDED_PERTURBATION'] : ['STABLE_UNDER_BOUNDED_PERTURBATION'], scenarios };
}
