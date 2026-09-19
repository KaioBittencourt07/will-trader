import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLearningLab } from '../learning/src/learningEngine.js';

function record(index, outcome, overrides = {}) {
  return {
    asset: 'EUR/USD',
    timeframe: '1min',
    regime: 'TREND',
    setupType: 'BREAKOUT',
    featureVersion: 'candle-price-action-v2',
    signalTimestamp: new Date(Date.UTC(2026, 0, 1, 10, index)).toISOString(),
    settledAt: new Date(Date.UTC(2026, 0, 1, 10, index, 30)).toISOString(),
    outcome,
    ...overrides
  };
}

test('learning lab collects evidence without mutating the production champion', () => {
  const records = [record(0, 'WIN'), record(1, 'LOSS'), record(2, null)];
  const lab = buildLearningLab(records, { minimumOutcomes: 30 });
  assert.equal(lab.version, 'will-learning-lab-v1');
  assert.equal(lab.mode, 'EVIDENCE_ONLY');
  assert.equal(lab.productionMutation, false);
  assert.equal(lab.automaticPromotion, false);
  assert.equal(lab.champion.unchanged, true);
  assert.equal(lab.evidence.studies, 3);
  assert.equal(lab.evidence.completedOutcomes, 2);
  assert.equal(lab.evidence.remainingOutcomes, 28);
  assert.equal(lab.state, 'COLLECTING_OUTCOMES');
  assert.deepEqual(lab.candidateInsights, []);
});

test('learning lab creates time-split candidate insights only after enough outcomes', () => {
  const records = Array.from({ length: 40 }, (_, index) =>
    record(index, index % 5 === 0 ? 'LOSS' : 'WIN')
  );
  const lab = buildLearningLab(records, {
    minimumOutcomes: 30,
    minimumSegmentOutcomes: 8,
    holdoutFraction: 0.25
  });
  assert.equal(lab.evidence.completedOutcomes, 40);
  assert.equal(lab.evidence.remainingOutcomes, 0);
  assert.ok(lab.candidateInsights.length > 0);
  assert.ok(lab.candidateInsights.some((candidate) => candidate.dimension === 'asset' && candidate.value === 'EUR/USD'));
  assert.ok(lab.candidateInsights.every((candidate) => candidate.train.n > 0 && candidate.holdout.n > 0));
  assert.equal(lab.productionMutation, false);
});

test('learning lab does not claim stable improvement when time split reverses direction', () => {
  const records = [];
  for (let index = 0; index < 30; index += 1) {
    records.push(record(index, index < 21 ? 'WIN' : 'LOSS'));
  }
  const lab = buildLearningLab(records, {
    minimumOutcomes: 30,
    minimumSegmentOutcomes: 8,
    holdoutFraction: 0.30
  });
  const asset = lab.candidateInsights.find((candidate) => candidate.dimension === 'asset');
  assert.ok(asset);
  assert.equal(asset.stableDirection, false);
  assert.equal(asset.evidenceState, 'UNSTABLE_ACROSS_TIME_SPLIT');
});
