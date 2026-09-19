import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readOos2CollectionEvidence } from '../backend/src/oos2CollectionEvidence.js';
import router, { getOos2CollectionStatus } from '../backend/src/routes/oos2Collection.js';
const id='autonomous-paper-monitor-v1:1';
const valid={monitorVersion:'autonomous-paper-monitor-v1',completedCycleIds:[id]};
function fixture(t, value) {
  const dir=mkdtempSync(join(tmpdir(),'oos2-runtime-')), stateFile=join(dir,'state.json');
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  if (value!==undefined) writeFileSync(stateFile,typeof value==='string'?value:JSON.stringify(value));
  return stateFile;
}
test('valid durable completion is only degraded and never returns complete IDs',t=>{
  const stateFile=fixture(t,{...valid,inventory:{sealed:true}});
  assert.deepEqual(readOos2CollectionEvidence({stateFile}),{completedCycleIds:[],completenessEvidence:'DEGRADED'});
});
for (const [label,value] of [['missing',undefined],['invalid JSON','{'],['wrong version',{...valid,monitorVersion:'other'}],
  ['missing IDs',{monitorVersion:valid.monitorVersion}],['invalid IDs',{...valid,completedCycleIds:[1]}],
  ['wrong ID prefix',{...valid,completedCycleIds:['other']}],['null',null]]) {
  test(`${label} state is unavailable`,t=>{
    assert.deepEqual(readOos2CollectionEvidence({stateFile:fixture(t,value)}),{completedCycleIds:[],completenessEvidence:'UNAVAILABLE'});
  });
}
const record=(cycle,settledAt)=>({id:cycle,metadata:{context:{monitorCycleId:cycle},featureSnapshot:{momentum:.1}},
  execution:{status:'PAPER_CONFIRMED'},status:'CLOSED',outcome:'WIN',settledAt,
  outcomeMetadata:{settlementVersion:'paper-outcome-settlement-v2',source:'paper-live-temporal-reference-v1'}});
function invoke(history,stateFile) {
  let body,code=200; const headers={};
  const res={set:(k,v)=>{headers[k]=v;},status:n=>{code=n;return res;},json:v=>{body=v;return res;}};
  getOos2CollectionStatus({app:{locals:{historyStore:{list:()=>history},oos2MonitorStateFile:stateFile}}},res);
  return {body,code,headers};
}
test('resolved or pending settlements plus monitor completion never imply completeness or leak performance',t=>{
  const candidates=Array.from({length:50},(_,i)=>record(`autonomous-paper-monitor-v1:post-${i}`,'2026-09-15T03:00:00.000Z'));
  const history=[...Array.from({length:217},(_,i)=>record(`autonomous-paper-monitor-v1:pre-${i}`,'2026-09-15T02:09:11.360Z')),...candidates];
  const stateFile=fixture(t,{...valid,completedCycleIds:candidates.map(r=>r.id)}), before=readFileSync(stateFile);
  for(const pending of [false,true]) {
    if(pending) history.push({...record(id,null),status:'OPEN',outcome:null});
    const snapshot=JSON.stringify(history), {body,code,headers}=invoke(history,stateFile);
    assert.equal(code,200); assert.equal(headers['Cache-Control'],'no-store');
    assert.equal(body.candidateCyclesObserved,50); assert.equal(body.completedCandidateCycles,0);
    assert.equal(body.formalAnalysisAllowed,false); assert.equal(body.completenessEvidence,'DEGRADED');
    assert.equal(body.historyContinuity,'PASS'); assert.equal(body.status,'COLLECTING');
    assert.doesNotMatch(JSON.stringify(body),/WIN|LOSS|TIE|outcome|winRate|binaryN|bootstrap|expectancy|confidence|accepted|rejected/);
    assert.equal(JSON.stringify(history),snapshot); assert.deepEqual(readFileSync(stateFile),before);
  }
});
test('route is GET-only and missing state cannot imply complete',t=>{
  assert.ok(router.stack.some(layer=>layer.route?.path==='/oos2/collection-status' && layer.route.methods.get));
  const {body}=invoke([record(id,'2026-09-15T03:00:00.000Z')],fixture(t));
  assert.equal(body.completenessEvidence,'UNAVAILABLE'); assert.equal(body.completedCandidateCycles,0);
});
test('history read failure is sanitized without logging error details',()=>{
  let body,code; const res={set:()=>{},status:n=>{code=n;return res;},json:v=>{body=v;}};
  getOos2CollectionStatus({app:{locals:{historyStore:{list:()=>{throw new Error('WIN secret');}}}}},res);
  assert.equal(code,503); assert.equal(body.ok,false); assert.equal(body.formalAnalysisAllowed,false);
  assert.doesNotMatch(JSON.stringify(body),/WIN|secret/);
});
