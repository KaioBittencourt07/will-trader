import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { evaluateOos2r, readOos2rFreeze, EXPECTED_OOS2R_FREEZE_SHA256 } from '../backend/src/evaluateOos2r.js';
import { canonicalIds,sha256,baselineCommitment,auditBaselineBytes,replayEvidence } from '../backend/src/oos2rEvidence.js';
import { canonical,digest,newManifest,canonicalDigest } from '../learning/src/cycleEvidenceManifest.js';
import { createCycleEvidenceJournal } from '../learning/src/cycleEvidenceJournal.js';

const freeze=readOos2rFreeze(),cut=Date.parse(freeze.edgeCut);
const legacy=[{id:'synthetic-legacy-a'},{id:'synthetic-legacy-b'}];
// Simulated external audit attestation. No private baseline file is read by tests/evaluator.
const baselineAudit={schemaVersion:'oos2r-baseline-audit-v1',status:'PASS',baselineCount:freeze.baselineCount,baselineIdsSha256:freeze.baselineIdsSha256,historyFileSha256:freeze.historyFileSha256};
function fixture(n=50,{offset=1,step=1,protocolId=freeze.protocolId,campaignId=freeze.campaignId,invalidAt=-1,openAt=-1,momentum=.5,momenta=null}={}) {
  const history=structuredClone(legacy),manifests=[],events=[];
  const append=(type,payload)=>{const body={version:'paper-cycle-evidence-wal-v1',sequence:events.length+1,previousHash:events.at(-1)?.hash??null,type,payload:structuredClone(payload)};events.push({...body,hash:digest(body)});};
  for(let i=0;i<n;i++) {
    const cycleId=`autonomous-paper-monitor-v1:fixture-${String(i).padStart(3,'0')}`,openedAt=new Date(cut+offset+i*step).toISOString();
    const m=newManifest({protocolId,campaignId,cycleId,writerGeneration:i+1,openedAt});
    const ctx={protocolId,campaignId,cycleId,writerGeneration:i+1},writerId=`w${i}`;
    append('CYCLE_OPEN_COMMIT',{...ctx,openedAt});append('WRITER_BEGIN',{...ctx,writerId});
    for(const [j,value]of (momenta??[momentum]).entries()) {
    const operationId=`op${i}-${j}`,recordId=`synthetic-r${i}-${j}`;
    const r={id:recordId,...ctx,status:'OPEN',outcome:null,settledAt:null,asset:'EUR/USD',direction:'BUY',regime:'fixture',setup:'fixture',
      metadata:{context:{monitorCycleId:cycleId},featureSnapshot:{momentum:value}}};
    append('RECORD_CREATE_INTENT',{...ctx,writerId,operationId,recordId,record:r});
    append('RECORD_CREATE_COMMIT',{...ctx,operationId,recordId});
    m.recordIds.push(recordId);m.expectedRecordCount++;m.inventoryRevision++;
    history.push({...r,status:'CLOSED',outcome:i%2?'LOSS':'WIN',settledAt:openedAt,execution:{status:'PAPER_CONFIRMED'},outcomeMetadata:{settlementVersion:'paper-outcome-settlement-v2',source:'paper-live-temporal-reference-v1'}});
    }
    append('WRITER_END',{...ctx,writerId});m.canonicalDigest=canonicalDigest(m);
    if(i===invalidAt){append('CYCLE_INVALID_COMMIT',{cycleId});m.state='INVALID';}
    else if(i!==openAt){append('CYCLE_SEAL_BEGIN',ctx);append('CYCLE_SEAL_COMMIT',{...ctx,canonicalDigest:m.canonicalDigest,sealedAt:openedAt});m.state='SEALED';m.sealedAt=openedAt;m.sealSequence=events.length;}
    manifests.push(m);
  }
  return {history,manifests,walBytes:Buffer.from(events.map(canonical).join('\n')+(events.length?'\n':'')),freeze,baselineAudit};
}
test('OOS2R baseline canonicalization is deterministic and rejects duplicate IDs',()=>{
  assert.deepEqual(canonicalIds([{id:'b'},{id:'a'}]),['a','b']);
  assert.equal(sha256(JSON.stringify(canonicalIds([{id:'b'},{id:'a'}]))),sha256('["a","b"]'));
  assert.throws(()=>canonicalIds([{id:'a'},{id:'a'}]));assert.equal(freeze.baselineCount,1095);
  const expected={baselineCount:2,baselineIdsSha256:'0473ef2dc0d324ab659d3580c1134e9d812035905c4781fdd6d529b0c6860e13'};
  assert.deepEqual(baselineCommitment([{id:'b'},{id:'a'}]),expected);
  assert.deepEqual(baselineCommitment([{id:'a'},{id:'b'}]),expected);
  assert.throws(()=>baselineCommitment([{id:'a'},{id:'a'}]));
});
test('OOS2R exact frozen bytes and inherited contract are pinned',()=>{
  const bytes=fs.readFileSync(new URL('../backend/config/experiments/edge-gate-oos2r-freeze.json',import.meta.url));
  assert.equal(sha256(bytes),EXPECTED_OOS2R_FREEZE_SHA256);assert.equal(freeze.frozenThreshold,.599936);assert.equal(freeze.operator,'<=');
  assert.equal(freeze.bootstrap.seed,20260915);assert.equal(freeze.bootstrap.replications,10000);assert.equal(freeze.activationAuthorized,false);
});
test('OOS2R equivalent JSON with changed bytes fails freeze verification',t=>{
  const dir=fs.mkdtempSync(path.join(tmpdir(),'oos2r-freeze-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'freeze.json');fs.writeFileSync(file,JSON.stringify(freeze));assert.throws(()=>readOos2rFreeze(file),/SHA256/);
  assert.equal(evaluateOos2r({...fixture(),freeze:structuredClone(freeze)}).formalAnalysisAllowed,false);
});
test('OOS2R original freeze and evaluator remain unchanged',()=>{
  assert.equal(sha256(fs.readFileSync(new URL('../backend/config/experiments/edge-gate-oos2-freeze.json',import.meta.url))),'1f0d03a1ffd2ab1adc0397bdaffccbb30d1b3bc0acbc5c87b7779b3e920b3564');
  const source=fs.readFileSync(new URL('../backend/src/evaluateOos2.js',import.meta.url),'utf8');
  // Pin original source across Git line-ending conversions.
  assert.equal(sha256(source.replace(/\r\n/g,'\n')),'e902769f5d76563f42d1c2a8181a2f642828840e6cbd309b7a2376813da185f6');
});
for(const offset of [-1,0,1])test(`OOS2R openedAt offset ${offset} strict prospective candidate rule`,()=>{
  assert.equal(evaluateOos2r(fixture(1,{offset})).candidateCyclesObserved,offset>0?1:0);
});
for(const key of ['protocolId','campaignId'])test(`OOS2R wrong ${key} never eligible`,()=>{
  assert.equal(evaluateOos2r(fixture(1,{[key]:'wrong'})).candidateCyclesObserved,0);
});
test('OOS2R legacy records cannot acquire membership from baseline commitment',()=>{
  const f=fixture();f.history[0].protocolId=freeze.protocolId;const r=evaluateOos2r(f);
  assert.equal(r.formalAnalysisAllowed,false);assert.ok(r.reasonCodes.includes('MEMBERSHIP_AMBIGUITY'));
});
test('OOS2R missing or wrong external audit blocks formal analysis; duplicate history fails closed',()=>{
  const f=fixture();delete f.baselineAudit;assert.equal(evaluateOos2r(f).formalAnalysisAllowed,false);
  assert.equal(evaluateOos2r({...fixture(),baselineAudit:{...baselineAudit,baselineIdsSha256:'wrong'}}).formalAnalysisAllowed,false);
  const g=fixture();g.history.push(g.history[0]);assert.ok(evaluateOos2r(g).reasonCodes.includes('HISTORY_IDS_INVALID'));
});
test('OOS2R baseline audit utility returns hashes only and reads IDs only',()=>{
  const bytes=Buffer.from('[{"id":"b"},{"id":"a"}]','utf8');
  const commitment=baselineCommitment(JSON.parse(bytes)),contract={...commitment,historyFileSha256:sha256(bytes)};
  const audit=auditBaselineBytes(bytes,contract);assert.equal(audit.status,'PASS');
  assert.deepEqual(Object.keys(audit).sort(),['schemaVersion','status','baselineCount','baselineIdsSha256','historyFileSha256'].sort());
  assert.throws(()=>auditBaselineBytes(Buffer.from(bytes.toString()+' '),contract));
  const row={id:'fixture'};Object.defineProperty(row,'outcome',{get(){throw Error('OUTCOME_READ');}});
  assert.equal(baselineCommitment([row]).baselineCount,1);
});
test('OOS2R evaluator has no private baseline dependency and hash never grants membership',()=>{
  const f=fixture();f.history=f.history.slice(legacy.length);assert.equal(evaluateOos2r(f).formalAnalysisAllowed,true);
  const noWal={...f,walBytes:Buffer.alloc(0),manifests:[]};assert.equal(evaluateOos2r(noWal).formalAnalysisAllowed,false);
  const source=fs.readFileSync(new URL('../backend/src/evaluateOos2r.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/baselinePath|baselineFile|canonicalIds\.json|private\//);
});
for(const key of ['writerGeneration','protocolId','campaignId'])test(`OOS2R broken record ${key} invalidates membership`,()=>{
  const f=fixture();delete f.history.at(-1)[key];const r=evaluateOos2r(f);assert.equal(r.formalAnalysisAllowed,false);assert.ok(r.invalidCycles>0);
});
test('OOS2R invalid first slot retained; #51 never replaces it',()=>{
  const r=evaluateOos2r(fixture(51,{invalidAt:0}));assert.equal(r.candidateCyclesObserved,51);assert.equal(r.selectedCycleIds.length,50);
  assert.match(r.selectedCycleIds[0],/000$/);assert.match(r.selectedCycleIds.at(-1),/049$/);assert.equal(r.formalAnalysisAllowed,false);assert.equal(r.invalidCycles,1);
});
test('OOS2R OPEN and unresolved SEALED retain slots without formal analysis',()=>{
  assert.equal(evaluateOos2r(fixture(50,{openAt:0})).formalAnalysisAllowed,false);
  const f=fixture();f.history.at(-1).status='OPEN';assert.equal(evaluateOos2r(f).formalAnalysisAllowed,false);
});
for(const outcome of ['VOID',null,'UNKNOWN'])test(`OOS2R nonterminal ${outcome} blocks`,()=>{
  const f=fixture();f.history.at(-1).outcome=outcome;assert.equal(evaluateOos2r(f).formalAnalysisAllowed,false);
});
test('OOS2R first50 deterministic regardless of history/projection order',()=>{
  const f=fixture(51,{step:0}),a=evaluateOos2r(f);f.history.reverse();f.manifests.reverse();const b=evaluateOos2r(f);
  assert.deepEqual(a,b);assert.equal(a.status,'FORMAL_FIRST_50');assert.equal(a.analysis.primaryCI.requestedReplications,10000);
  assert.equal(a.analysis.primaryCI.seed,20260915);assert.equal(a.analysis.accepted.binaryN,50);
});
test('OOS2R frozen threshold uses <=; no raw Q50 or score substitution',()=>{
  assert.equal(evaluateOos2r(fixture(50,{momentum:.599936})).analysis.acceptedCycles,50);
  assert.equal(evaluateOos2r(fixture(50,{momentum:.5999361})).analysis.acceptedCycles,0);
  assert.equal(evaluateOos2r(fixture(50,{momentum:null})).analysis.invalidMetricCycles,50);
});
test('OOS2R DATA_INVALID separately reported; TIE excluded from binary denominator',()=>{
  const f=fixture();f.history.at(-1).outcome='DATA_INVALID';f.history.at(-2).outcome='TIE';
  const r=evaluateOos2r(f);assert.equal(r.formalAnalysisAllowed,true);assert.equal(r.analysis.allSelected.DATA_INVALID,1);
  assert.equal(r.analysis.accepted.binaryN,48);assert.equal(r.analysis.expectancy,'NOT_AVAILABLE');
});
test('OOS2R aggregates abs momentum over each whole cycle and preserves bootstrap clusters',()=>{
  const r=evaluateOos2r(fixture(50,{momenta:[-.2,.8]}));assert.equal(r.analysis.acceptedCycles,50);
  assert.equal(r.analysis.accepted.N,100);assert.equal(r.analysis.primaryCI.clusterCount,50);
  assert.equal(evaluateOos2r(fixture(50,{momenta:[0,1.4]})).analysis.acceptedCycles,0);
});
test('OOS2R pre-cut settlement invalidates its slot, no replacement',()=>{
  const f=fixture(51);f.history[legacy.length].settledAt=freeze.edgeCut;
  const r=evaluateOos2r(f);assert.equal(r.formalAnalysisAllowed,false);assert.equal(r.selectedCycleIds.length,50);assert.match(r.selectedCycleIds[0],/000$/);
});
test('OOS2R missing/extra inventory and absent PAPER provenance block formal analysis',()=>{
  const f=fixture();f.history.pop();assert.equal(evaluateOos2r(f).formalAnalysisAllowed,false);
  const g=fixture();g.history.push({...g.history.at(-1),id:'extra'});assert.equal(evaluateOos2r(g).formalAnalysisAllowed,false);
  const h=fixture();delete h.history.at(-1).execution;assert.equal(evaluateOos2r(h).formalAnalysisAllowed,false);
});
test('OOS2R later settlement preserves membership/inventory; creation momentum tampering blocks',()=>{
  const f=fixture(),r=f.history.at(-1),before={...r};r.settledAt=new Date(cut+10000).toISOString();
  assert.equal(evaluateOos2r(f).formalAnalysisAllowed,true);
  for(const key of ['protocolId','campaignId','cycleId','writerGeneration'])assert.equal(r[key],before[key]);
  r.metadata.featureSnapshot.momentum=.1;assert.equal(evaluateOos2r(f).formalAnalysisAllowed,false);
});
test('OOS2R preliminary output has no performance aggregation and leaves inputs unchanged',()=>{
  const f=fixture(49),before=JSON.stringify(f.history);const r=evaluateOos2r(f);
  assert.equal(r.analysis,undefined);assert.doesNotMatch(JSON.stringify(r),/WIN|LOSS|TIE|winRate|binaryN|bootstrap|expectancy|acceptedCycles/);
  assert.equal(JSON.stringify(f.history),before);
});
test('OOS2R corrupted/truncated WAL, projection or orphan membership blocks without repair',()=>{
  const f=fixture();assert.equal(evaluateOos2r({...f,walBytes:f.walBytes.subarray(0,-1)}).formalAnalysisAllowed,false);
  f.manifests[0].canonicalDigest='bad';assert.equal(evaluateOos2r(f).formalAnalysisAllowed,false);
  const g=fixture();g.history.at(-1).cycleId='autonomous-paper-monitor-v1:orphan';assert.equal(evaluateOos2r(g).formalAnalysisAllowed,false);
});
test('OOS2R reader accepts actual foundation WAL without writing or changing projections',t=>{
  const dir=fs.mkdtempSync(path.join(tmpdir(),'oos2r-journal-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const j=createCycleEvidenceJournal({directory:dir}),m=j.openCycle({protocolId:freeze.protocolId,campaignId:freeze.campaignId,cycleId:'autonomous-paper-monitor-v1:actual-fixture',openedAt:new Date(cut+1).toISOString(),history:[]});
  j.sealCycle({...m,sealedAt:new Date(cut+2).toISOString()});
  const files=fs.readdirSync(dir),before=files.map(name=>[name,fs.readFileSync(path.join(dir,name))]);
  const rows=replayEvidence(fs.readFileSync(path.join(dir,'journal.jsonl')),[j.readManifest(m.cycleId)]);assert.equal(rows[0].projectionValid,true);
  assert.deepEqual(fs.readdirSync(dir),files);for(const [name,bytes]of before)assert.deepEqual(fs.readFileSync(path.join(dir,name)),bytes);
});
