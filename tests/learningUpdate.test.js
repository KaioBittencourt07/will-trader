import assert from 'node:assert/strict';
import test from 'node:test';
import { summarize } from '../learning/src/statistics.js';
import { buildLearningReadiness } from '../learning/src/calibration.js';

test('each recorded outcome updates the learning summary without implying calibrated performance', () => {
  const records = [{ direction: 'BUY', outcome: 'WIN', confidence: 72 }];
  const metrics = summarize(records);
  const readiness = buildLearningReadiness(records, { minimumSamples: 30 });
  assert.equal(metrics.wins, 1);
  assert.equal(metrics.losses, 0);
  assert.equal(readiness.calibrationReady, false);
});

test('metrics distinguish data rejections from intentional WAIT decisions', () => {
  const metrics = summarize([
    { direction: 'WAIT', metadata: { blockReasons: ['DATA_QUALITY_STALE_MARKET_DATA'] } },
    { direction: 'WAIT', metadata: { blockReasons: ['LOW_CONFIDENCE'] } },
    { direction: 'BUY', status: 'SKIPPED' },
    { direction: 'SELL', status: 'OPEN' }
  ]);
  assert.deepEqual(metrics.funnel, {
    observations: 4,
    dataRejected: 1,
    strategyWaits: 1,
    directionalCandidates: 2,
    releasedTrades: 1,
    blockedDirectional: 1,
    completedTrades: 0
  });
});

test('outcome provenance separates operator records from unverified outcomes', () => {
  const metrics = summarize([
    { direction: 'BUY', outcome: 'WIN', execution: { status: 'CONFIRMED' } },
    { direction: 'SELL', outcome: 'LOSS', outcomeMetadata: { recordedBy: 'operator' } },
    { direction: 'BUY', outcome: 'WIN' }
  ]);
  assert.deepEqual(metrics.provenance, {
    operatorRecordedOutcomes: 2,
    automaticPaperOutcomes: 0,
    unverifiedOutcomes: 1
  });
});
