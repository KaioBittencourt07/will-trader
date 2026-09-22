import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHistoryStoreWithPaperAuthority} from '../learning/src/historyStore.js';
import {createCycleEvidenceRuntime} from '../learning/src/cycleEvidenceRuntime.js';
import {createCycleEvidenceJournal} from '../learning/src/cycleEvidenceJournal.js';
import {replayEvidence,verifyRecoveryInterruptedCycle} from '../backend/src/oos2rEvidence.js';
import {settleDuePaperCampaignOutcomes} from '../backend/src/paperOutcomeSettlement.js';

const at='2026-09-22T00:00:00.000Z',cycleId='autonomous-paper-monitor-v1:successor-fixture';
const protocolId='synthetic-successor',campaignId='synthetic-campaign';
function setup(t){
  const root=fs.mkdtempSync(path.join(tmpdir(),'will-successor-recovery-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  let n=0;const historyPath=path.join(root,'history.json'),directory=path.join(root,'wal');
  const bundle=createHistoryStoreWithPaperAuthority({filePath:historyPath,id:()=>`prepared-${++n}`,now:()=>at});
  const runtime=(options={})=>createCycleEvidenceRuntime({directory,protocolId,campaignId,historyStore:bundle.historyStore,
    observationTerminalRequired:true,recoverInterruptedOpenCycles:true,maxCandidateCycles:1,now:()=>at,...options});
  const input=i=>({decision:{direction:'BUY',releaseEligible:true,clickTime:at},data:{asset:'EUR/USD',price:1.1},
    context:{decisionId:`decision-${i}`,monitorCycleId:cycleId}});
  return {...bundle,root,directory,historyPath,runtime,input};
}
function settlement(s,runtime){
  let calls=0;
  const feed={referenceAtOrAfter(){calls++;throw new Error('MARKET_ACCESS_FORBIDDEN');}};
  for(let i=0;i<3;i++)settleDuePaperCampaignOutcomes({historyStore:s.historyStore,paperMutationPort:s.paperMutationPort,
    biquoteForexFeed:feed,scope:{protocolId,campaignId},now:Date.parse(at)+120000,
    recordAdmission:record=>runtime.isPaperSettlementAllowed(record)});
  assert.equal(calls,0);
  assert.ok(s.historyStore.list().every(record=>record.execution?.status!=='PAPER_CONFIRMED'&&record.outcome==null));
}
for(const point of ['BEFORE_INTENT','AFTER_INTENT_SECOND','AFTER_READY','AFTER_PREPARE','AFTER_COMMIT_SECOND','AFTER_INSERT']){
  test(`interrupted ${point} is invisible until authority and consumes its slot on recovery`,t=>{
    const s=setup(t);let intents=0,commits=0;
    const runtime=s.runtime({fault:p=>{
      if(point===p||point==='AFTER_INTENT_SECOND'&&p==='AFTER_INTENT'&&++intents===2||
        point==='AFTER_COMMIT_SECOND'&&p==='AFTER_COMMIT'&&++commits===2)throw new Error('injected');
    }});
    runtime.recover();runtime.openMonitorCycle(cycleId);const writer=runtime.beginCycleWriter(cycleId);
    for(let i=0;i<4;i++)runtime.stageRecord(writer,s.input(i));
    assert.throws(()=>runtime.commitStagedRecords(writer),/EVIDENCE_STORAGE_FAILURE/);
    assert.equal(s.historyStore.list().length,point==='AFTER_INSERT'?4:0);
    const disk=fs.existsSync(s.historyPath)?JSON.parse(fs.readFileSync(s.historyPath,'utf8')):[];
    assert.equal(disk.length,point==='AFTER_INSERT'?4:0);
    settlement(s,runtime);
    const restarted=s.runtime();settlement(s,restarted);
    const recovered=restarted.recover();
    assert.deepEqual(recovered.sealedCycleIds,[cycleId]);
    assert.equal(restarted.health().collectionClosed,true);
    assert.throws(()=>restarted.openMonitorCycle('autonomous-paper-monitor-v1:replacement'),/CANDIDATE_LIMIT/);
    const rows=s.historyStore.list(),expected=['BEFORE_INTENT','AFTER_INTENT_SECOND'].includes(point)?0:4;
    assert.equal(rows.length,expected);
    settlement(s,restarted);
    const journal=createCycleEvidenceJournal({directory:s.directory,observationTerminalRequired:true});
    const result=journal.recover({history:rows});
    assert.equal(result.observationTerminals[cycleId].outcome,'RECOVERY_INTERRUPTED');
    assert.equal(result.observationTerminals[cycleId].replacementAllowed,false);
    assert.equal(result.observationTerminals[cycleId].performanceEligible,false);
    const bytes=fs.readFileSync(path.join(s.directory,'journal.jsonl'));
    const projection=[journal.readManifest(cycleId)];
    const [entry]=replayEvidence(bytes,projection);
    assert.deepEqual(verifyRecoveryInterruptedCycle(entry,rows),{valid:true,performanceEligible:false,replacementAllowed:false,slotConsumed:true});
    const before=fs.readFileSync(path.join(s.directory,'journal.jsonl'));
    assert.deepEqual(s.runtime().recover().sealedCycleIds,[cycleId]);
    assert.deepEqual(fs.readFileSync(path.join(s.directory,'journal.jsonl')),before);
  });
}
test('forged cycle history blocks recovery without sealing or replacement',t=>{
  const s=setup(t),runtime=s.runtime({fault:p=>{if(p==='AFTER_READY')throw new Error('injected');}});
  runtime.recover();runtime.openMonitorCycle(cycleId);const writer=runtime.beginCycleWriter(cycleId);
  for(let i=0;i<4;i++)runtime.stageRecord(writer,s.input(i));
  assert.throws(()=>runtime.commitStagedRecords(writer));
  const forged={...s.historyStore.prepareDecisionRecord(s.input(99)),cycleId,protocolId,campaignId,writerGeneration:1};
  s.historyStore.insertPreparedRecord(forged);
  assert.throws(()=>s.runtime().recover(),/EVIDENCE_STORAGE_FAILURE/);
  assert.notEqual(createCycleEvidenceJournal({directory:s.directory}).readManifest(cycleId).state,'SEALED');
});
test('normal SUCCESS remains SUCCESS and is not reclassified on restart',t=>{
  const s=setup(t),runtime=s.runtime();runtime.recover();runtime.openMonitorCycle(cycleId);
  const writer=runtime.beginCycleWriter(cycleId);runtime.commitRecord(writer,s.input(0));runtime.endCycleWriter(writer);
  runtime.commitObservationTerminal(cycleId,{outcome:'SUCCESS'});runtime.sealMonitorCycle(cycleId);
  const restarted=s.runtime();assert.deepEqual(restarted.recover().sealedCycleIds,[cycleId]);
  assert.equal(restarted.isPaperSettlementAllowed(s.historyStore.list()[0]),true);
  assert.equal(createCycleEvidenceJournal({directory:s.directory}).recover({history:s.historyStore.list()}).observationTerminals[cycleId].outcome,'SUCCESS');
});
test('durable SUCCESS terminal with interrupted seal retains SUCCESS on restart',t=>{
  const s=setup(t),runtime=s.runtime();runtime.recover();runtime.openMonitorCycle(cycleId);
  const writer=runtime.beginCycleWriter(cycleId);runtime.commitRecord(writer,s.input(0));runtime.endCycleWriter(writer);
  runtime.commitObservationTerminal(cycleId,{outcome:'SUCCESS'});
  assert.deepEqual(s.runtime().recover().sealedCycleIds,[cycleId]);
  assert.equal(createCycleEvidenceJournal({directory:s.directory}).recover({history:s.historyStore.list()}).observationTerminals[cycleId].outcome,'SUCCESS');
});
test('interrupted recovery terminal replay finishes seal exactly once',t=>{
  const s=setup(t),runtime=s.runtime();runtime.recover();runtime.openMonitorCycle(cycleId);
  const faulting=createCycleEvidenceJournal({directory:s.directory,observationTerminalRequired:true,
    fault:(point,type)=>{if(point==='AFTER_WAL_COMMIT'&&type==='CYCLE_RECOVERY_TERMINAL')throw new Error('interrupted terminal projection');}});
  assert.throws(()=>s.runtime({journal:faulting}).recover(),/EVIDENCE_STORAGE_FAILURE/);
  assert.deepEqual(s.runtime().recover().sealedCycleIds,[cycleId]);
  const bytes=fs.readFileSync(path.join(s.directory,'journal.jsonl'));
  assert.deepEqual(s.runtime().recover().sealedCycleIds,[cycleId]);
  assert.deepEqual(fs.readFileSync(path.join(s.directory,'journal.jsonl')),bytes);
});
