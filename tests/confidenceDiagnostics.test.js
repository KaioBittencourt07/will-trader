import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConfidenceDiagnostics } from '../backtest/src/confidenceDiagnostics.js';

function decision(id, confidence, direction = 'BUY', overrides = {}) {
  return { id, confidence, direction, executable: direction !== 'WAIT', blocked: false, ...overrides };
}
function settled(id, outcome) {
  return { id, status: 'SETTLED', outcome };
}

test('confidence diagnostics preserves no-trade decisions and reports observed outcome bands only', () => {
  const decisions = [
    decision('low-win', 55, 'BUY'),
    decision('low-loss', 55, 'SELL'),
    decision('high-win', 95, 'BUY'),
    decision('high-unresolved', 95, 'BUY'),
    decision('wait', 25, 'WAIT'),
    decision('blocked', 98, 'BUY', { blocked: true, executable: false }),
    decision('not-executable', 88, 'SELL', { executable: false })
  ];
  const results = [
    settled('low-win', 'WIN'),
    settled('low-loss', 'LOSS'),
    settled('high-win', 'WIN'),
    { id: 'high-unresolved', status: 'UNRESOLVED', reasonCode: 'NO_EXPIRY_QUOTE' },
    { id: 'wait', status: 'WAIT' },
    { id: 'blocked', status: 'BLOCKED' },
    { id: 'not-executable', status: 'BLOCKED' }
  ];
  const report = buildConfidenceDiagnostics({
    decisions,
    results,
    sampleRole: 'TEST',
    minimumBinaryPerBand: 1,
    minimumTotalBinary: 2
  });

  assert.equal(report.schemaVersion, 'will-confidence-outcome-diagnostics-v1');
  assert.equal(report.counts.decisions, 7);
  assert.equal(report.counts.waitDecisions, 1);
  assert.equal(report.counts.blockedDecisions, 1);
  assert.equal(report.counts.nonActionableDecisions, 1);
  assert.equal(report.counts.directionalCandidates, 4);
  assert.equal(report.counts.settledTrades, 3);
  assert.equal(report.counts.wins, 2);
  assert.equal(report.counts.losses, 1);
  assert.equal(report.counts.unresolvedTrades, 1);
  assert.equal(report.binaryN, 3);
  assert.equal(report.binaryWinRate, 2 / 3);
  assert.equal(report.noTradeRate, 3 / 7);

  const low = report.confidenceBands.find((band) => band.band === '50-59');
  assert.equal(low.directionalCandidates, 2);
  assert.equal(low.binaryN, 2);
  assert.equal(low.observedBinaryWinRate, 0.5);
  assert.equal(low.status, 'DESCRIPTIVE_ONLY');

  const high = report.confidenceBands.find((band) => band.band === '90-100');
  assert.equal(high.directionalCandidates, 2);
  assert.equal(high.wins, 1);
  assert.equal(high.unresolvedTrades, 1);
  assert.equal(high.binaryN, 1);
  assert.equal(high.status, 'DESCRIPTIVE_ONLY');

  assert.equal(report.confidenceSemantics, 'HEURISTIC_COMPOSITE_SCORE_NOT_PROBABILITY');
  assert.equal(report.calibrationPerformed, false);
  assert.equal(report.edgeProven, false);
  assert.ok(report.reasonCodes.includes('UNRESOLVED_OR_MISSING_RESULTS'));
});

test('unspecified/in-sample role cannot be reported as out-of-sample evidence', () => {
  const report = buildConfidenceDiagnostics({
    decisions: [decision('one', 80)],
    results: [settled('one', 'WIN')],
    sampleRole: 'TRAIN',
    minimumBinaryPerBand: 1,
    minimumTotalBinary: 1
  });
  assert.equal(report.roleIsPotentiallyOutOfSample, false);
  assert.equal(report.status, 'DESCRIPTIVE_ONLY_INSUFFICIENT_OR_UNVERIFIED_EVIDENCE');
  assert.ok(report.reasonCodes.includes('SAMPLE_ROLE_NOT_OUT_OF_SAMPLE'));
  assert.equal(report.edgeProven, false);
});

test('test/prospective labeling changes only the review readiness, never proves calibration', () => {
  const decisions = [];
  const results = [];
  for (let i = 0; i < 35; i++) {
    decisions.push(decision(`id-${i}`, 75));
    results.push(settled(`id-${i}`, i < 22 ? 'WIN' : 'LOSS'));
  }
  const report = buildConfidenceDiagnostics({
    decisions,
    results,
    sampleRole: 'PROSPECTIVE',
    minimumBinaryPerBand: 30,
    minimumTotalBinary: 30
  });
  assert.equal(report.roleIsPotentiallyOutOfSample, true);
  assert.equal(report.counts.directionalCandidates, 35);
  assert.equal(report.binaryN, 35);
  assert.equal(report.status, 'DESCRIPTIVE_OUT_OF_SAMPLE_ASSOCIATION_READY_FOR_INDEPENDENT_REVIEW');
  assert.equal(report.confidenceBands.find((band) => band.band === '70-79').status, 'DESCRIPTIVE_ONLY');
  assert.equal(report.calibrationPerformed, false);
  assert.equal(report.edgeProven, false);
});

test('missing or inconsistent IDs, roles and thresholds fail closed', () => {
  assert.throws(() => buildConfidenceDiagnostics({ decisions: null, results: [] }), /ARRAYS_REQUIRED/);
  assert.throws(() => buildConfidenceDiagnostics({
    decisions: [decision('dup', 50), decision('dup', 50)],
    results: []
  }), /DECISION_ID_DUPLICATE/);
  assert.throws(() => buildConfidenceDiagnostics({
    decisions: [decision('a', 50)],
    results: [settled('a', 'WIN'), settled('a', 'LOSS')]
  }), /RESULT_ID_DUPLICATE/);
  assert.throws(() => buildConfidenceDiagnostics({
    decisions: [decision('a', 50)],
    results: [settled('a', 'WIN')],
    sampleRole: 'DEPLOYED'
  }), /SAMPLE_ROLE_INVALID/);
  assert.throws(() => buildConfidenceDiagnostics({
    decisions: [decision('a', 50)],
    results: [settled('a', 'WIN')],
    minimumBinaryPerBand: 0
  }), /MINIMUM_BAND_SAMPLE_INVALID/);
});

test('missing outcomes and orphan results are visible and do not silently shrink evidence', () => {
  const report = buildConfidenceDiagnostics({
    decisions: [decision('missing-result', 60)],
    results: [settled('orphan-result', 'WIN')],
    sampleRole: 'TEST',
    minimumBinaryPerBand: 1,
    minimumTotalBinary: 1
  });
  assert.equal(report.counts.missingResults, 1);
  assert.equal(report.counts.orphanResults, 1);
  assert.equal(report.counts.unresolvedTrades, 1);
  assert.ok(report.reasonCodes.includes('UNRESOLVED_OR_MISSING_RESULTS'));
  assert.ok(report.reasonCodes.includes('ORPHAN_RESULTS_PRESENT'));
  assert.equal(report.binaryN, 0);
  assert.equal(report.edgeProven, false);
});
