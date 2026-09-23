import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHistoryStore} from '../learning/src/historyStore.js';
import {createCycleEvidenceRuntime} from '../learning/src/cycleEvidenceRuntime.js';
import {createCycleEvidenceJournal} from '../learning/src/cycleEvidenceJournal.js';
import {baselineCommitment,sha256} from '../backend/src/oos2rEvidence.js';
import {baselineRecordsDigest} from '../backend/src/oos2uFreeze.js';
import {OOS2V_CONTRACT,OOS2V_PROTOCOL,OOS2V_START_AUTHORIZATION,OOS2V_RESTART_AUTHORIZATION,validateOos2vDraft} from '../backend/src/oos2vProtocol.js';
import {readOos2vFreeze} from '../backend/src/oos2vFreeze.js';
import {evaluateOos2v} from '../backend/src/evaluateOos2v.js';
import {inspectOos2vDirectoryStatus} from '../backend/src/oos2vStatus.js';
import {prepareOos2vEnvironment,inspectOos2vRestart,createPreparedOos2vRuntime,createRecoveredOos2vRuntime} from '../backend/src/oos2vActivation.js';

const cut='2026-09-23T00:00:00.000Z',later=()=>Date.parse(cut)+60000;
function setup(t){
  const root=fs.mkdtempSync(path.join(tmpdir(),'will-oos2v-prefreeze-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const historyFile=path.join(root,'history.json'),evidenceDirectory=path.join(root,'successor-evidence');
  const freezeFile=path.join(root,'fixture-freeze.json'),freezeHashFile=path.join(root,'fixture-freeze.sha256');
  const baseline=[{id:'fixture-baseline-only',status:'CLOSED'}];fs.writeFileSync(historyFile,JSON.stringify(baseline));
  const bytes=fs.readFileSync(historyFile),commitment=baselineCommitment(baseline);
  const raw={schemaVersion:'edge-gate-oos2v-freeze-v1',policy:'IMMUTABLE_AFTER_FREEZE',experiment:'WILL Edge Gate OOS-2V',
    protocolId:OOS2V_PROTOCOL,campaignId:'fixture-oos2v-only',edgeCut:cut,createdAt:new Date(later()).toISOString(),
    sourceHead:'b8b10a1e520f623fb42edb0be7168a5593008c3d',mode:OOS2V_CONTRACT.mode,
    metric:OOS2V_CONTRACT.metric,frozenThreshold:OOS2V_CONTRACT.frozenThreshold,operator:OOS2V_CONTRACT.operator,
    baselineCount:commitment.baselineCount,baselineIdsSha256:commitment.baselineIdsSha256,
    baselineRecordsSha256:baselineRecordsDigest(baseline),historyFileSha256:sha256(bytes),
    checkpoint:{candidateCycles:50,selection:OOS2V_CONTRACT.selection,replacement:'NONE'},
    bootstrap:OOS2V_CONTRACT.bootstrap,recoveryInterrupted:OOS2V_CONTRACT.recoveryInterrupted,
    expectancy:'NOT_AVAILABLE',noRetuning:true,noEarlyStopping:true,noAutomaticLivePromotion:true,
    automatedBrokerExecution:false,activationAuthorized:false};
  const publish=value=>{fs.writeFileSync(freezeFile,JSON.stringify(value));fs.writeFileSync(freezeHashFile,sha256(fs.readFileSync(freezeFile)));};
  publish(raw);
  const freeze=readOos2vFreeze(freezeFile,freezeHashFile);
  const store=createHistoryStore({filePath:historyFile,id:(()=>{let i=0;return()=>`fixture-${++i}`;})(),now:()=>new Date(later()).toISOString()});
  const env={WILL_OOS2V_START_AUTHORIZATION:OOS2V_START_AUTHORIZATION,WILL_CYCLE_EVIDENCE_ENABLED:'true',
    WILL_CYCLE_EVIDENCE_PROTOCOL_ID:OOS2V_PROTOCOL,WILL_CYCLE_EVIDENCE_CAMPAIGN_ID:freeze.campaignId,
    WILL_HISTORY_FILE:historyFile,WILL_CYCLE_EVIDENCE_DIRECTORY:evidenceDirectory,
    WILL_OOS2V_FREEZE_FILE:freezeFile,WILL_OOS2V_FREEZE_HASH_FILE:freezeHashFile,
    WILL_OOS2V_EVIDENCE_SCAN_ROOTS:JSON.stringify([root])};
  const runtime=(maxCandidateCycles=50)=>createCycleEvidenceRuntime({directory:evidenceDirectory,protocolId:OOS2V_PROTOCOL,
    campaignId:freeze.campaignId,historyStore:store,observationTerminalRequired:true,recoverInterruptedOpenCycles:true,
    maxCandidateCycles,now:()=>new Date(later()).toISOString()});
  const evidence=()=>({walBytes:fs.readFileSync(path.join(evidenceDirectory,'journal.jsonl')),
    manifests:fs.readdirSync(evidenceDirectory).filter(name=>name.endsWith('.manifest.json'))
      .map(name=>JSON.parse(fs.readFileSync(path.join(evidenceDirectory,name),'utf8')))});
  return {root,historyFile,evidenceDirectory,freezeFile,freezeHashFile,freeze,raw,publish,store,env,runtime,evidence};
}
function fill(s,total,{interruptedAt=10,interruptedRecord=false}={}){
  let runtime=s.runtime(null);runtime.recover();
  for(let i=0;i<total;i++){
    const id=`autonomous-paper-monitor-v1:${i}`;runtime.openMonitorCycle(id);
    if(i===interruptedAt){
      if(interruptedRecord){
        const writer=runtime.beginCycleWriter(id);
        runtime.commitRecord(writer,{decision:{direction:'BUY',releaseEligible:true,clickTime:new Date(later()).toISOString()},
          data:{asset:'EUR/USD',price:1.1,momentum:0.3},context:{monitorCycleId:id,decisionId:'interrupted-record'}});
        runtime.endCycleWriter(writer);
      }
      runtime=s.runtime(null);runtime.recover();
    }
    else{runtime.commitObservationTerminal(id,{outcome:'SUCCESS'});runtime.sealMonitorCycle(id);}
  }
  return runtime;
}
test('draft freezes the statistical and recovery contract without production identity',()=>{
  assert.equal(validateOos2vDraft({...OOS2V_CONTRACT}),true);
  for(const patch of [{frozenThreshold:0.5},{operator:'>'},{candidateCycles:51},{replacement:'REPLACE'},
    {bootstrap:{...OOS2V_CONTRACT.bootstrap,replications:1}},
    {recoveryInterrupted:{...OOS2V_CONTRACT.recoveryInterrupted,performanceEligible:true}},
    {noEarlyStopping:false},{noAutomaticLivePromotion:false},{automatedBrokerExecution:true},{campaignId:'forged'}])
    assert.throws(()=>validateOos2vDraft({...OOS2V_CONTRACT,...patch}),/OOS2V_DRAFT_INVALID/);
});
test('future freeze reader requires exact bytes, baseline and immutable hypothesis',t=>{
  const s=setup(t);assert.equal(s.freeze.frozenThreshold,0.599936);
  fs.appendFileSync(s.freezeFile,' ');assert.throws(()=>readOos2vFreeze(s.freezeFile,s.freezeHashFile),/OOS2V_FREEZE_INVALID/);
  s.publish({...s.raw,operator:'>'});assert.throws(()=>readOos2vFreeze(s.freezeFile,s.freezeHashFile),/OOS2V_FREEZE_INVALID/);
});
test('first 50 include interrupted slot, which is valid but never performance eligible',t=>{
  const s=setup(t);fill(s,50,{interruptedRecord:true});
  const result=evaluateOos2v({history:s.store.list(),freeze:s.freeze,...s.evidence()});
  assert.equal(result.candidateCyclesObserved,50);assert.equal(result.recoveryInterruptedCycles,1);
  assert.equal(result.completedCandidateCycles,50);assert.equal(result.formalAnalysisAllowed,true);
  assert.equal(result.analysis.eligibleCycles,49);assert.equal(result.analysis.performanceRecords,0);
  const original=s.store.list().find(r=>r.protocolId===OOS2V_PROTOCOL);
  const poisoned={...original,status:'CLOSED',outcome:'WIN',settledAt:new Date(later()+120000).toISOString(),
    execution:{...original.execution,status:'PAPER_CONFIRMED'},
    outcomeMetadata:{settlementVersion:'paper-outcome-settlement-v2',source:'paper-live-temporal-reference-v1'}};
  const adversarial=evaluateOos2v({history:s.store.list().map(r=>r.id===original.id?poisoned:r),freeze:s.freeze,...s.evidence()});
  assert.equal(adversarial.formalAnalysisAllowed,true);
  assert.equal(adversarial.analysis.WIN,0);
  assert.equal(adversarial.analysis.performanceRecords,0);
  assert.equal(result.analysis.expectancy,'NOT_AVAILABLE');assert.equal(result.newCandidateAdmissionAllowed,false);
  const status=inspectOos2vDirectoryStatus({evidenceDirectory:s.evidenceDirectory,history:s.store.list(),freeze:s.freeze});
  assert.equal(status.recoveryInterruptedCycles,1);assert.equal(status.automatedBrokerExecution,false);
  assert.equal(JSON.stringify(status).includes('winRate'),false);
});
test('49 plus interrupted plus a later cycle is 51, never a replacement',t=>{
  const s=setup(t);fill(s,51,{interruptedAt:49});
  const result=evaluateOos2v({history:s.store.list(),freeze:s.freeze,...s.evidence()});
  assert.equal(result.candidateCyclesObserved,51);assert.equal(result.recoveryInterruptedCycles,1);
  assert.equal(result.formalAnalysisAllowed,false);assert.equal(result.newCandidateAdmissionAllowed,false);
  assert.ok(result.reasonCodes.includes('POST_FIRST50_EVIDENCE'));
});
test('forged projection, history or malformed recovery terminal blocks formal analysis',t=>{
  const s=setup(t);fill(s,50);const e=s.evidence();
  assert.equal(evaluateOos2v({history:s.store.list(),freeze:s.freeze,...e}).formalAnalysisAllowed,true);
  const manifests=e.manifests.map(m=>({...m}));manifests[0].recordIds=['forged'];
  assert.equal(evaluateOos2v({history:s.store.list(),freeze:s.freeze,walBytes:e.walBytes,manifests}).formalAnalysisAllowed,false);
  const forgedHistory=[...s.store.list(),{id:'forged',protocolId:OOS2V_PROTOCOL,campaignId:s.freeze.campaignId,
    cycleId:'autonomous-paper-monitor-v1:0',writerGeneration:1}];
  assert.equal(evaluateOos2v({history:forgedHistory,freeze:s.freeze,...e}).formalAnalysisAllowed,false);
  const corrupted=Buffer.from(e.walBytes.toString('utf8').replace('PROCESS_INTERRUPTION','OTHER_INTERRUPTION'));
  assert.equal(evaluateOos2v({history:s.store.list(),freeze:s.freeze,walBytes:corrupted,manifests:e.manifests}).formalAnalysisAllowed,false);
});
test('activation requires exact authorization and recovery opt-in only for OOS-2V',t=>{
  const s=setup(t);
  assert.equal(prepareOos2vEnvironment({},{}),null);
  assert.throws(()=>prepareOos2vEnvironment({...s.env,WILL_OOS2V_START_AUTHORIZATION:'WRONG'}),/EXACT_ACTIVATION/);
  assert.throws(()=>prepareOos2vEnvironment({...s.env,WILL_CYCLE_EVIDENCE_CAMPAIGN_ID:'wrong'}),/EXACT_ACTIVATION/);
  const prepared=prepareOos2vEnvironment(s.env,{now:later});
  assert.equal(prepared.report.ready,true);assert.equal(fs.existsSync(s.evidenceDirectory),false);
  const runtime=createPreparedOos2vRuntime({prepared,historyStore:s.store,now:later});
  runtime.recover();runtime.openMonitorCycle('autonomous-paper-monitor-v1:0');
  const restartEnv={...s.env,WILL_OOS2V_START_AUTHORIZATION:undefined,WILL_OOS2V_RESTART_AUTHORIZATION:OOS2V_RESTART_AUTHORIZATION};
  delete restartEnv.WILL_OOS2V_START_AUTHORIZATION;
  const restart=prepareOos2vEnvironment(restartEnv,{now:later});
  const recovered=createRecoveredOos2vRuntime({prepared:restart,historyStore:s.store,now:later});
  assert.deepEqual(recovered.recover().sealedCycleIds,['autonomous-paper-monitor-v1:0']);
  assert.equal(recovered.health().candidateCyclesObserved,1);
  const old=createCycleEvidenceRuntime({directory:path.join(s.root,'retired-fixture'),protocolId:'will-edge-gate-oos2u-v1',
    campaignId:'retired-fixture',historyStore:s.store,observationTerminalRequired:true,now:()=>new Date(later()).toISOString()});
  old.recover();old.openMonitorCycle('autonomous-paper-monitor-v1:retired');
  assert.throws(()=>createCycleEvidenceRuntime({directory:path.join(s.root,'retired-fixture'),protocolId:'will-edge-gate-oos2u-v1',
    campaignId:'retired-fixture',historyStore:s.store,observationTerminalRequired:true}).recover(),/STORAGE_FAILURE/);
});
test('baseline prefix mutation blocks every new OOS-2V admission',t=>{
  const s=setup(t);const prepared=prepareOos2vEnvironment(s.env,{now:later});
  const runtime=createPreparedOos2vRuntime({prepared,historyStore:s.store,now:later});runtime.recover();
  runtime.openMonitorCycle('autonomous-paper-monitor-v1:0');runtime.commitObservationTerminal('autonomous-paper-monitor-v1:0',{outcome:'SUCCESS'});
  runtime.sealMonitorCycle('autonomous-paper-monitor-v1:0');
  fs.writeFileSync(s.historyFile,JSON.stringify([{id:'unexpected-baseline'}]));
  assert.throws(()=>runtime.openMonitorCycle('autonomous-paper-monitor-v1:1'),/BASELINE_CHANGED/);
  assert.equal(runtime.health().paused,true);
});

const crashEvents=['CYCLE_OPEN_COMMIT','WRITER_BEGIN','RECORD_CREATE_INTENT','RECORD_BATCH_READY',
  'RECORD_CREATE_COMMIT','CYCLE_RECOVERY_TERMINAL','CYCLE_SEAL_BEGIN','CYCLE_SEAL_COMMIT'];
for(const event of crashEvents){
  test(`OOS-2V hard exit after WAL ${event}: exact stale projection recovers once`,t=>{
    const s=setup(t),cycleId='autonomous-paper-monitor-v1:crash',openedAt=new Date(later()).toISOString();
    fs.mkdirSync(s.evidenceDirectory);
    const journal=createCycleEvidenceJournal({directory:s.evidenceDirectory,observationTerminalRequired:true});
    const open=()=>journal.openCycle({protocolId:OOS2V_PROTOCOL,campaignId:s.freeze.campaignId,cycleId,openedAt,history:s.store.list()});
    if(event!=='CYCLE_OPEN_COMMIT')open();
    const ctx={cycleId,writerGeneration:1,writerId:'writer-fixture'};
    const record={id:'record-fixture',cycleId,writerGeneration:1,protocolId:OOS2V_PROTOCOL,campaignId:s.freeze.campaignId,
      status:'OPEN',outcome:null,settledAt:null,decisionId:'decision-fixture'};
    if(['RECORD_CREATE_INTENT','RECORD_BATCH_READY','RECORD_CREATE_COMMIT'].includes(event))journal.beginWriter(ctx);
    if(['RECORD_BATCH_READY','RECORD_CREATE_COMMIT'].includes(event))
      journal.beginRecordCreation({...ctx,operationId:'operation-fixture',record});
    if(event==='RECORD_CREATE_COMMIT')journal.readyRecordBatch({...ctx,batchId:'batch-fixture',operationIds:['operation-fixture']});
    if(['CYCLE_SEAL_BEGIN','CYCLE_SEAL_COMMIT'].includes(event))
      journal.commitObservationTerminal({cycleId,writerGeneration:1,outcome:'SUCCESS'});
    if(event==='CYCLE_SEAL_COMMIT'){
      const beginOnly=createCycleEvidenceJournal({directory:s.evidenceDirectory,observationTerminalRequired:true,
        fault:(point,type)=>{if(point==='AFTER_PROJECTION'&&type==='CYCLE_SEAL_BEGIN')throw new Error('STOP_AFTER_BEGIN');}});
      assert.throws(()=>beginOnly.sealCycle({...ctx,sealedAt:openedAt}),/STOP_AFTER_BEGIN/);
    }
    const journalUrl=new URL('../learning/src/cycleEvidenceJournal.js',import.meta.url).href;
    const action={
      CYCLE_OPEN_COMMIT:`j.openCycle({protocolId:${JSON.stringify(OOS2V_PROTOCOL)},campaignId:${JSON.stringify(s.freeze.campaignId)},cycleId,openedAt,history:[]})`,
      WRITER_BEGIN:'j.beginWriter(ctx)',
      RECORD_CREATE_INTENT:'j.beginRecordCreation({...ctx,operationId:"operation-fixture",record})',
      RECORD_BATCH_READY:'j.readyRecordBatch({...ctx,batchId:"batch-fixture",operationIds:["operation-fixture"]})',
      RECORD_CREATE_COMMIT:'j.commitRecordCreation({...ctx,operationId:"operation-fixture"})',
      CYCLE_RECOVERY_TERMINAL:'j.recoverInterruptedCycle({cycleId,sealedAt:openedAt,history:[]})',
      CYCLE_SEAL_BEGIN:'j.sealCycle({...ctx,sealedAt:openedAt})',
      CYCLE_SEAL_COMMIT:'j.sealCycle({...ctx,sealedAt:openedAt})'
    }[event];
    const code=`import {createCycleEvidenceJournal} from ${JSON.stringify(journalUrl)};
      const cycleId=${JSON.stringify(cycleId)},openedAt=${JSON.stringify(openedAt)},ctx=${JSON.stringify(ctx)},record=${JSON.stringify(record)};
      const j=createCycleEvidenceJournal({directory:${JSON.stringify(s.evidenceDirectory)},observationTerminalRequired:true,
        fault:(point,type)=>{if(point==='AFTER_WAL_COMMIT'&&type===${JSON.stringify(event)})process.exit(73)}});
      ${action};`;
    const child=spawnSync(process.execPath,['--input-type=module','--eval',code],{encoding:'utf8',timeout:15000,env:{...process.env,NODE_OPTIONS:''}});
    assert.equal(child.status,73,child.stderr);assert.equal(child.stderr,'');
    const options={historyFile:s.historyFile,evidenceDirectory:s.evidenceDirectory,scanRoots:[s.root],
      freezeFile:s.freezeFile,freezeHashFile:s.freezeHashFile};
    assert.equal(inspectOos2vRestart(options).recoverable,true);
    const prepared={mode:'RESTART',options,freeze:s.freeze,report:{evidenceDirectory:s.evidenceDirectory}};
    const recovered=createRecoveredOos2vRuntime({prepared,historyStore:s.store,now:later});
    assert.deepEqual(recovered.recover().sealedCycleIds,[cycleId]);
    const first=s.evidence(),records=s.store.list().filter(r=>r.cycleId===cycleId);
    assert.equal(first.manifests.length,1);assert.equal(first.manifests[0].state,'SEALED');
    assert.deepEqual(first.manifests[0].recordIds,records.map(r=>r.id));
    assert.equal(recovered.health().candidateCyclesObserved,1);
    const second=createRecoveredOos2vRuntime({prepared,historyStore:s.store,now:later});
    assert.deepEqual(second.recover().sealedCycleIds,[cycleId]);
    assert.deepEqual(s.evidence().walBytes,first.walBytes);
    assert.deepEqual(s.store.list().filter(r=>r.cycleId===cycleId),records);
  });
}
test('OOS-2V restart rejects a valid-shaped but impossible projection',t=>{
  const s=setup(t);fs.mkdirSync(s.evidenceDirectory);
  const journal=createCycleEvidenceJournal({directory:s.evidenceDirectory,observationTerminalRequired:true});
  journal.openCycle({protocolId:OOS2V_PROTOCOL,campaignId:s.freeze.campaignId,
    cycleId:'autonomous-paper-monitor-v1:forged',openedAt:new Date(later()).toISOString(),history:s.store.list()});
  const file=path.join(s.evidenceDirectory,fs.readdirSync(s.evidenceDirectory).find(name=>name.endsWith('.manifest.json')));
  const projection=JSON.parse(fs.readFileSync(file,'utf8'));projection.openedAt=new Date(later()+1000).toISOString();
  fs.writeFileSync(file,JSON.stringify(projection));
  assert.throws(()=>inspectOos2vRestart({historyFile:s.historyFile,evidenceDirectory:s.evidenceDirectory,
    scanRoots:[s.root],freezeFile:s.freezeFile,freezeHashFile:s.freezeHashFile}),/OOS2V_RESTART_EVIDENCE_INVALID/);
});
