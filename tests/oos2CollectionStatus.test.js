import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { oos2CollectionStatus } from '../backend/src/oos2CollectionStatus.js';
const cut = '2026-09-15T02:09:11.360Z';
const row = (id, settledAt = '2026-09-15T03:00:00.000Z') => ({
  metadata: { context: { monitorCycleId: `autonomous-paper-monitor-v1:${id}` }, featureSnapshot: { momentum: .2 } },
  execution: { status: 'PAPER_CONFIRMED' }, outcome: 'WIN', settledAt,
  outcomeMetadata: { settlementVersion: 'paper-outcome-settlement-v2', source: 'paper-live-temporal-reference-v1' }
});
const pre = (n=217) => Array.from({length:n},(_,i) => row(`pre-${i}`,cut));
const post = (n=50) => Array.from({length:n},(_,i) => row(`post-${String(i).padStart(3,'0')}`));
const options = rows => ({completedCycleIds: rows.map(r => r.metadata.context.monitorCycleId)});
test('zero candidates reports collecting at zero percent', () => {
  const r = oos2CollectionStatus([]); assert.equal(r.candidateCyclesObserved,0);
  assert.equal(r.requiredCandidateCycles,50); assert.equal(r.progressPercent,0); assert.equal(r.status,'COLLECTING');
});
test('49 complete candidates remain collecting', () => {
  const rows = post(49), r = oos2CollectionStatus([...pre(),...rows],options(rows));
  assert.equal(r.status,'COLLECTING'); assert.equal(r.progressPercent,98);
});
test('settlements never infer completeness', () => {
  const r = oos2CollectionStatus([...pre(),...post()]);
  assert.equal(r.status,'COLLECTING'); assert.equal(r.incompleteCandidateCycles,50);
});
test('50 independently complete candidates with continuity and freeze pass are ready', () => {
  const rows=post(), r=oos2CollectionStatus([...pre(),...rows],options(rows));
  assert.equal(r.status,'READY_FOR_FORMAL_ANALYSIS'); assert.equal(r.formalAnalysisAllowed,true);
  assert.equal(r.historyContinuity,'PASS'); assert.equal(r.freezeIntegrity,'PASS');
});
test('216 and 218 official pre-cut records block readiness', () => {
  for (const n of [216,218]) { const rows=post(), r=oos2CollectionStatus([...pre(n),...rows],options(rows));
    assert.equal(r.historyContinuity,'FAIL'); assert.equal(r.preCutOfficialObserved,n); assert.equal(r.formalAnalysisAllowed,false); }
});
test('changed freeze bytes block readiness without mutation', () => {
  const dir=mkdtempSync(join(tmpdir(),'oos2-collection-'));
  try { const path=join(dir,'freeze.json');
    const bytes=Buffer.concat([readFileSync(new URL('../backend/config/experiments/edge-gate-oos2-freeze.json',import.meta.url)),Buffer.from(' ')]);
    writeFileSync(path,bytes); const rows=post();
    const r=oos2CollectionStatus([...pre(),...rows],{...options(rows),freezePath:path});
    assert.equal(r.freezeIntegrity,'FAIL'); assert.equal(r.formalAnalysisAllowed,false); assert.deepEqual(readFileSync(path),bytes);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('cross-cut and invalid candidates remain among first 50 without replacement', () => {
  const rows=post(51), before=pre(); before[0].metadata.context.monitorCycleId=rows[0].metadata.context.monitorCycleId;
  rows[1].metadata.featureSnapshot.momentum=null;
  const r=oos2CollectionStatus([...before,...rows].reverse(),options(rows.slice(1)));
  assert.equal(r.candidateCyclesObserved,50); assert.equal(r.completedCandidateCycles,49);
  assert.equal(r.crossCutCycles,1); assert.equal(r.invalidCycles,2); assert.equal(r.formalAnalysisAllowed,false);
});
test('unorderable official cycle blocks readiness', () => {
  const rows=post(), r=oos2CollectionStatus([...pre(),...rows,row('bad','invalid')],options(rows));
  assert.equal(r.unorderableCycles,1); assert.equal(r.formalAnalysisAllowed,false);
});
test('exact output allowlist and JSON cannot leak performance or caller content', () => {
  const rows=post(); rows[0].outcome='LOSS'; rows[1].outcome='TIE'; rows[0].secret='WIN bootstrap';
  const r=oos2CollectionStatus([...pre(),...rows],options(rows));
  assert.deepEqual(Object.keys(r).sort(),['experiment','status','edgeCut','thresholdLocked','operatorLocked','candidateCyclesObserved',
    'requiredCandidateCycles','completedCandidateCycles','incompleteCandidateCycles','invalidCycles','crossCutCycles','unorderableCycles',
    'preCutOfficialExpected','preCutOfficialObserved','historyContinuity','freezeIntegrity','progressPercent','formalAnalysisAllowed'].sort());
  assert.doesNotMatch(JSON.stringify(r),/outcome|WIN|LOSS|TIE|winRate|binaryN|confidence|bootstrap|accepted|rejected|expectancy/);
});
test('input is unchanged; module has no writers, broker, logs or evaluator invocation', () => {
  const rows=[...pre(),...post()], before=JSON.stringify(rows); oos2CollectionStatus(rows);
  assert.equal(JSON.stringify(rows),before);
  const source=readFileSync(new URL('../backend/src/oos2CollectionStatus.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/console\.|writeFile|appendFile|historyStore|broker|evaluateOos2\s*\(/);
});
test('official filters exclude unrelated evidence and malformed arguments fail closed', () => {
  const rows=post(5); rows[0].execution.status='OTHER'; rows[1].outcomeMetadata.source='OTHER';
  rows[2].outcomeMetadata.settlementVersion='OTHER'; rows[3].metadata.context.monitorCycleId='manual'; rows[4].outcome='OTHER';
  assert.equal(oos2CollectionStatus(rows).candidateCyclesObserved,0);
  assert.throws(()=>oos2CollectionStatus(null)); assert.throws(()=>oos2CollectionStatus([],{completedCycleIds:[null]}));
});
