import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { CONTRACT, readFreeze, evaluateOos2, clusterBootstrap } from '../backend/src/evaluateOos2.js';
const freezePath = new URL('../backend/config/experiments/edge-gate-oos2-freeze.json', import.meta.url);
const record = (cycle='a', momentum=0.2, outcome='WIN', settledAt='2026-09-15T03:00:00.000Z') => ({
  metadata: { context: { monitorCycleId: `autonomous-paper-monitor-v1:${cycle}` }, featureSnapshot: { momentum } },
  execution: { status: 'PAPER_CONFIRMED' }, outcomeMetadata: { settlementVersion: 'paper-outcome-settlement-v2', source: 'paper-live-temporal-reference-v1' },
  outcome, settledAt, asset: 'EUR/USD', direction: 'BUY', regime: 'TREND', score: 0, confidence: 0
});
test('BOM freeze loads without byte changes and original SHA256 matches', () => {
  const before = readFileSync(freezePath); assert.equal(before.subarray(0,3).toString('hex'), 'efbbbf');
  assert.equal(readFreeze(freezePath).frozenThreshold, 0.599936);
  assert.equal(createHash('sha256').update(before).digest('hex').toUpperCase(), '1F0D03A1FFD2AB1ADC0397BDAFFCCBB30D1B3BC0ACBC5C87B7779B3E920B3564');
  assert.deepEqual(readFileSync(freezePath), before);
});
test('every frozen field is mandatory and exact', () => {
  for (const key of Object.keys(CONTRACT)) { const missing = {...CONTRACT}; delete missing[key];
    assert.throws(() => evaluateOos2([], missing)); assert.throws(() => evaluateOos2([], {...CONTRACT, [key]: 'wrong'})); }
  assert.throws(() => evaluateOos2([], {...CONTRACT, frozenThreshold: 0.599936477924654}));
  assert.throws(() => evaluateOos2({}, CONTRACT));
});
test('semantic-equivalent freeze with changed whitespace fails runtime SHA without rewriting', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oos2-freeze-'));
  try {
    const path = join(dir, 'freeze.json');
    const original = readFileSync(freezePath);
    const changed = Buffer.concat([original, Buffer.from(' ')]);
    writeFileSync(path, changed);
    assert.deepEqual(JSON.parse(changed.toString('utf8').replace(/^\uFEFF/, '')), readFreeze(freezePath));
    assert.throws(() => readFreeze(path), /^Error: INVALID_OOS2_FREEZE_SHA256$/);
    assert.deepEqual(readFileSync(path), changed);
    assert.deepEqual(readFileSync(freezePath), original);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('official filters exclude every nonmatching provenance/status/outcome', () => {
  const rows = [record(), record('b'), record('c'), record('d'), record('e'), record('f')];
  rows[1].metadata.context.monitorCycleId = 'manual:x'; rows[2].execution.status = 'CONFIRMED';
  rows[3].outcomeMetadata.settlementVersion = 'v1'; rows[4].outcomeMetadata.source = 'operator'; rows[5].outcome = 'DATA_INVALID';
  assert.equal(evaluateOos2(rows, CONTRACT).eligibleRecords, 1);
});
test('cycle mean of absolute momentum uses inclusive frozen threshold, not raw Q50 score or confidence', () => {
  const rows = [record('a', -0.8), record('a', 0.2), record('b', 0.599936), record('c', 0.5999362)];
  const r = evaluateOos2(rows, CONTRACT); assert.equal(r.acceptedCycles, 2); assert.equal(r.rejectedCycles, 1);
  assert.equal(r.acceptedRecords, 3); assert.equal(r.cycles[0].MeanAbsMomentum, 0.5);
  assert.equal(r.recordCoverage, 3/4); assert.equal(r.cycleCoverage, 2/3);
});
test('any invalid momentum invalidates its whole cycle without coercion', () => {
  for (const bad of [undefined, null, '0.2', NaN, Infinity, -Infinity, true]) {
    const rows = [record('a'), record('a')]; rows[1].metadata.featureSnapshot.momentum = bad;
    const r = evaluateOos2(rows, CONTRACT); assert.equal(r.invalidCycles, 1); assert.equal(r.acceptedRecords, 0);
  }
});
test('strict cut and cross-cut cycles fail closed, including equality at cutoff', () => {
  const r = evaluateOos2([record('a', 0.1, 'WIN', CONTRACT.edgeCut), record('a'), record('b', 0.1, 'WIN', CONTRACT.edgeCut)], CONTRACT);
  assert.equal(r.eligibleRecords, 1); assert.equal(r.eligibleCycles, 1); assert.equal(r.invalidCycles, 1);
  assert.ok(r.cycles[0].reasons.includes('CROSS_CUT_CYCLE')); assert.equal(r.acceptedRecords, 0);
});
test('invalid dates cannot hide cross-cut evidence', () => {
  const r = evaluateOos2([record('a'), record('a', 0.1, 'WIN', 'bad')], CONTRACT);
  assert.equal(r.invalidCycles, 1); assert.equal(r.acceptedRecords, 0);
});
test('record outcomes statistics coverage diagnostic groups and Wilson interval are explicit', () => {
  const rows = ['LOSS','LOSS','TIE','LOSS','WIN'].map((o,i) => record(String(i), .1, o, `2026-09-15T03:00:0${i}.000Z`));
  const snapshot = JSON.stringify(rows); const r = evaluateOos2(rows, CONTRACT);
  assert.equal(r.N, 5); assert.equal(r.binaryN, 4); assert.equal(r.binaryWinRate, .25); assert.equal(r.TIE, 1);
  assert.equal(r.maxLosingStreak, 2); assert.equal(r.secondary.asset['EUR/USD'].N, 5);
  assert.ok(r.naiveWilsonInterval95[0]<.25 && r.naiveWilsonInterval95[1]>.25);
  assert.match(r.naiveWilsonMethod, /naive\/descriptive/);
  assert.equal(r.expectancy, 'NOT_AVAILABLE'); assert.equal(r.financialEdge, 'NOT_AVAILABLE'); assert.equal(r.brokerExecuted, false);
  assert.equal(JSON.stringify(rows), snapshot);
});
test('empty and all-tie datasets avoid invented rates', () => {
  const empty = evaluateOos2([], CONTRACT); assert.equal(empty.binaryWinRate, null); assert.equal(empty.cycleCoverage, null);
  const tie = evaluateOos2([record('a', .1, 'TIE')], CONTRACT); assert.equal(tie.binaryN, 0); assert.equal(tie.confidenceInterval95.interval95, null);
  assert.equal(tie.confidenceInterval95.zeroBinaryReplications, 10000);
});
test('bootstrap is deterministic and independent of record order', () => {
  const rows = [record('a', .1, 'WIN'), record('b', .1, 'LOSS'), record('b', .1, 'TIE')];
  assert.deepEqual(clusterBootstrap(rows), clusterBootstrap([...rows].reverse()));
  assert.equal(clusterBootstrap(rows).validReplications, 10000);
});
test('whole-cycle resampling preserves outcome ratios and unequal cluster sizes', () => {
  // Both clusters have WR 1/3 but different sizes; any whole-cluster draw retains 1/3.
  const rows = ['WIN','LOSS','LOSS','TIE'].map(o => record('a', .1, o));
  rows.push(...['WIN','LOSS','LOSS','WIN','LOSS','LOSS'].map(o => record('b', .1, o)));
  const result = clusterBootstrap(rows); assert.deepEqual(result.interval95, [1/3,1/3]);
  assert.equal(result.clusterCount, 2); assert.equal(result.validReplications, 10000);
  assert.deepEqual(clusterBootstrap([record('a',.1,'WIN'), record('a',.1,'LOSS')]).interval95, [.5,.5]);
});
test('tie-only resamples are counted and excluded, not converted into losses', () => {
  const r = clusterBootstrap([record('a',.1,'WIN'), record('b',.1,'TIE')]);
  assert.deepEqual(r.interval95, [1,1]); assert.ok(r.zeroBinaryReplications>0);
  assert.equal(r.validReplications+r.zeroBinaryReplications, 10000);
});
test('same settledAt uses id before original input order for losing streak', () => {
  const rows = ['LOSS','WIN','LOSS'].map((o,i) => ({...record(String(i),.1,o), id:String(i)}));
  assert.equal(evaluateOos2(rows, CONTRACT).maxLosingStreak, 1);
  assert.equal(evaluateOos2([rows[0],rows[2],rows[1]], CONTRACT).maxLosingStreak, 1);
});
test('coverage separates invalid candidates from valid gate rejections', () => {
  const rows = [record('a',.1),record('b',.9),record('c')]; rows[2].metadata.featureSnapshot.momentum = null;
  const r = evaluateOos2(rows,CONTRACT);
  assert.equal(r.candidateCycles,3); assert.equal(r.validCycles,2); assert.equal(r.invalidCycles,1);
  assert.equal(r.coverageAllCandidates,1/3); assert.equal(r.coverageValidCandidates,1/2);
});
test('first fifty candidates fixed before integrity filtering, completion and later outcomes', () => {
  const rows = Array.from({length:51},(_,i) => record(String(i),.1,'WIN',new Date(Date.parse(CONTRACT.edgeCut)+1000+i*1000).toISOString()));
  rows[0].metadata.featureSnapshot.momentum = null;
  rows.push(record('1',.1,'WIN',CONTRACT.edgeCut));
  rows.push(...Array.from({length:216},(_,i) => record(`pre-${i}`,.1,'WIN',CONTRACT.edgeCut)));
  const ids = rows.map(r => r.metadata.context.monitorCycleId);
  const early = evaluateOos2(rows.slice(0,49),CONTRACT,{completedCycleIds:ids}); assert.equal(early.analysisStatus,'PRELIMINARY');
  assert.equal(evaluateOos2(rows,CONTRACT).analysisStatus,'PRELIMINARY');
  const formal = evaluateOos2(rows,CONTRACT,{completedCycleIds:ids});
  assert.equal(formal.analysisStatus,'FORMAL_FIRST_50'); assert.equal(formal.candidateCycles,50);
  assert.equal(formal.invalidCycles,2); assert.equal(formal.acceptedCycles,48);
  assert.equal(formal.checkpoint.laterCandidateCyclesExcluded,1);
  assert.ok(!formal.checkpoint.selectedCycleIds.includes('autonomous-paper-monitor-v1:50'));
  const pendingFirst = evaluateOos2(rows,CONTRACT,{completedCycleIds:ids.filter(id=>id!==ids[0])});
  assert.equal(pendingFirst.analysisStatus,'PRELIMINARY'); assert.deepEqual(pendingFirst.checkpoint.selectedCycleIds,formal.checkpoint.selectedCycleIds);
});
test('formal checkpoint requires exactly 217 official pre-cut records and retains cross-cut candidates', () => {
  const pre = Array.from({length:217},(_,i) => record(`pre-${i}`,.1,'WIN',CONTRACT.edgeCut));
  const post = Array.from({length:50},(_,i) => record(`post-${i}`));
  const options = { completedCycleIds: post.map(r => r.metadata.context.monitorCycleId) };
  const full = evaluateOos2([...pre,...post],CONTRACT,options);
  assert.equal(full.analysisStatus,'FORMAL_FIRST_50');
  assert.deepEqual(full.historyContinuity,{expectedPreCutOfficialRecords:217,observedPreCutOfficialRecords:217,matchesFreeze:true});
  for (const rows of [pre.slice(1), [...pre,pre[0]]]) {
    const r = evaluateOos2([...rows,...post],CONTRACT,options);
    assert.equal(r.analysisStatus,'PRELIMINARY'); assert.equal(r.historyContinuity.matchesFreeze,false);
    assert.equal(r.historyContinuity.observedPreCutOfficialRecords,rows.length);
    assert.deepEqual(r.checkpoint.selectedCycleIds,full.checkpoint.selectedCycleIds);
  }
  pre[0].metadata.context.monitorCycleId = post[0].metadata.context.monitorCycleId;
  const cross = evaluateOos2([...pre,...post],CONTRACT,options);
  assert.equal(cross.invalidCycles,1); assert.ok(cross.cycles[0].reasons.includes('CROSS_CUT_CYCLE'));
  const excluded = record('excluded',.1,'WIN',CONTRACT.edgeCut); excluded.execution.status = 'OTHER';
  assert.equal(evaluateOos2([...pre,...post,excluded],CONTRACT,options).historyContinuity.observedPreCutOfficialRecords,217);
});
test('plan and provenance explicitly preserve untouched full-contract validation', () => {
  const plan = JSON.parse(readFileSync(new URL('../backend/config/experiments/edge-gate-oos2-analysis-plan.json',import.meta.url),'utf8'));
  assert.equal(plan.primaryCheckpointCandidateCycles,50); assert.equal(plan.primaryCI.replications,10000);
  assert.equal(plan.threshold,CONTRACT.frozenThreshold); assert.equal(plan.operator,'<=');
  const p = JSON.parse(readFileSync(new URL('../backend/config/experiments/edge-gate-oos2-provenance.json',import.meta.url),'utf8'));
  assert.equal(p.thresholdDerivationDataset,'IS exclusively'); assert.match(p.operatorSelection,/retrospectively/);
  assert.match(p.OOS1Interpretation,/Not independent/);
});
