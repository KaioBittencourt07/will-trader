import { wilsonInterval } from './statistics.js';

const BINARY_OUTCOMES = new Set(['WIN', 'LOSS']);
const DEFAULT_MINIMUM_OUTCOMES = 30;
const DEFAULT_MINIMUM_SEGMENT_OUTCOMES = 8;
const DEFAULT_HOLDOUT_FRACTION = 0.30;

function completed(records = []) {
  return records.filter((record) => BINARY_OUTCOMES.has(record?.outcome));
}

function timestamp(record = {}) {
  const parsed = Date.parse(record.settledAt ?? record.signalTimestamp ?? record.createdAt ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function observed(records = []) {
  const wins = records.filter((record) => record.outcome === 'WIN').length;
  const losses = records.filter((record) => record.outcome === 'LOSS').length;
  const n = wins + losses;
  return {
    n,
    wins,
    losses,
    winRate: n ? wins / n : null,
    interval95: wilsonInterval(wins, n)
  };
}

function valueFor(record, dimension) {
  if (dimension === 'hour') {
    const parsed = new Date(record.signalTimestamp ?? '').getUTCHours();
    return Number.isFinite(parsed) ? String(parsed) : 'UNKNOWN';
  }
  if (dimension === 'featureVersion') return record.featureVersion ?? record.metadata?.featureSnapshot?.featureVersion ?? 'UNKNOWN';
  if (dimension === 'setup') return record.setupType ?? record.setup ?? 'UNKNOWN';
  return record[dimension] ?? 'UNKNOWN';
}

function splitChronologically(records, holdoutFraction) {
  const ordered = [...records].sort((left, right) => timestamp(left) - timestamp(right));
  if (ordered.length < 2) return { train: ordered, holdout: [] };
  const holdoutN = Math.max(1, Math.floor(ordered.length * holdoutFraction));
  return {
    train: ordered.slice(0, -holdoutN),
    holdout: ordered.slice(-holdoutN)
  };
}

function segmentCandidates(records, {
  dimensions,
  minimumSegmentOutcomes,
  holdoutFraction
}) {
  const candidates = [];
  for (const dimension of dimensions) {
    const groups = new Map();
    for (const record of records) {
      const value = String(valueFor(record, dimension));
      const group = groups.get(value) ?? [];
      group.push(record);
      groups.set(value, group);
    }
    for (const [value, group] of groups) {
      if (group.length < minimumSegmentOutcomes) continue;
      const { train, holdout } = splitChronologically(group, holdoutFraction);
      const trainStats = observed(train);
      const holdoutStats = observed(holdout);
      if (!trainStats.n || !holdoutStats.n) continue;
      const stableDirection = (trainStats.winRate >= 0.5) === (holdoutStats.winRate >= 0.5);
      candidates.push({
        dimension,
        value,
        total: observed(group),
        train: trainStats,
        holdout: holdoutStats,
        stableDirection,
        evidenceState: stableDirection ? 'CONSISTENT_ACROSS_TIME_SPLIT' : 'UNSTABLE_ACROSS_TIME_SPLIT'
      });
    }
  }
  return candidates.sort((left, right) => {
    const leftRate = left.holdout.winRate ?? -1;
    const rightRate = right.holdout.winRate ?? -1;
    return rightRate - leftRate || right.total.n - left.total.n;
  });
}

export function buildLearningLab(records = [], {
  minimumOutcomes = DEFAULT_MINIMUM_OUTCOMES,
  minimumSegmentOutcomes = DEFAULT_MINIMUM_SEGMENT_OUTCOMES,
  holdoutFraction = DEFAULT_HOLDOUT_FRACTION,
  championStrategyVersion = process.env.WILL_STRATEGY_VERSION || 'will-core-v1'
} = {}) {
  const studies = Array.isArray(records) ? records : [];
  const outcomes = completed(studies);
  const baseline = observed(outcomes);
  const remainingOutcomes = Math.max(0, minimumOutcomes - baseline.n);
  const dimensions = ['asset', 'timeframe', 'regime', 'setup', 'hour', 'featureVersion'];
  const candidates = baseline.n >= minimumOutcomes
    ? segmentCandidates(outcomes, { dimensions, minimumSegmentOutcomes, holdoutFraction })
    : [];
  const stableCandidates = candidates.filter((candidate) => candidate.stableDirection);
  const best = stableCandidates[0] ?? null;

  return {
    version: 'will-learning-lab-v1',
    mode: 'EVIDENCE_ONLY',
    productionMutation: false,
    automaticPromotion: false,
    champion: {
      strategyVersion: championStrategyVersion,
      unchanged: true
    },
    evidence: {
      studies: studies.length,
      completedOutcomes: baseline.n,
      wins: baseline.wins,
      losses: baseline.losses,
      observedWinRate: baseline.winRate,
      interval95: baseline.interval95,
      minimumOutcomes,
      remainingOutcomes
    },
    temporalValidation: {
      method: 'chronological-train-holdout',
      holdoutFraction,
      minimumSegmentOutcomes
    },
    state: remainingOutcomes > 0
      ? 'COLLECTING_OUTCOMES'
      : best
        ? 'CANDIDATE_INSIGHTS_AVAILABLE'
        : 'ENOUGH_OUTCOMES_NO_STABLE_CANDIDATE',
    candidateInsights: candidates.slice(0, 20),
    bestCandidateInsight: best,
    nextAction: remainingOutcomes > 0
      ? `Collect ${remainingOutcomes} more real WIN/LOSS outcomes before proposing a strategy challenger.`
      : best
        ? 'Review stable candidate insight in LAB; production champion remains unchanged until explicit out-of-sample promotion criteria are implemented and satisfied.'
        : 'Keep collecting outcomes; current evidence does not support a stable challenger across the chronological holdout.'
  };
}
