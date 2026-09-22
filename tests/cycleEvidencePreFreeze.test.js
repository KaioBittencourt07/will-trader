import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHistoryStore } from '../learning/src/historyStore.js';
import { createCycleEvidenceRuntime } from '../learning/src/cycleEvidenceRuntime.js';
import { createCycleEvidenceJournal } from '../learning/src/cycleEvidenceJournal.js';

const at='2026-09-18T00:00:00.000Z', cycleId='autonomous-paper-monitor-v1:pre-freeze-fixture';
const modules=Object.fromEntries(['historyStore','cycleEvidenceRuntime','cycleEvidenceJournal'].map(name=>[name,new URL(`../learning/src/${name}.js`,import.meta.url).href]));
function setup(t) {
  const directory=fs.mkdtempSync(path.join(tmpdir(),'will-prefreeze-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const historyPath=path.join(directory,'history.json'), journalDir=path.join(directory,'wal');
  const store=()=>createHistoryStore({filePath:historyPath,id:()=> 'fixture-record',now:()=>at});
  const runtime=historyStore=>createCycleEvidenceRuntime({directory:journalDir,protocolId:'test-only',campaignId:'synthetic-only',historyStore,now:()=>at});
  return {directory,historyPath,journalDir,store,runtime};
}
function child(s, action) {
  const code=`
    import fs from 'node:fs';
    import path from 'node:path';
    import assert from 'node:assert/strict';
    import { createHistoryStoreWithPaperAuthority } from ${JSON.stringify(modules.historyStore)};
    import { createCycleEvidenceRuntime } from ${JSON.stringify(modules.cycleEvidenceRuntime)};
    import { createCycleEvidenceJournal } from ${JSON.stringify(modules.cycleEvidenceJournal)};
    const directory=${JSON.stringify(s.journalDir)}, historyPath=${JSON.stringify(s.historyPath)};
    const cycleId=${JSON.stringify(cycleId)}, at=${JSON.stringify(at)};
    const {historyStore:store,paperMutationPort}=createHistoryStoreWithPaperAuthority({filePath:historyPath,id:()=> 'fixture-record',now:()=>at});
    const options={directory,protocolId:'test-only',campaignId:'synthetic-only',historyStore:store,now:()=>at};
    const input={decision:{direction:'BUY',releaseEligible:true,clickTime:at},data:{asset:'EUR/USD',price:1.1},context:{decisionId:'fixture-decision',monitorCycleId:cycleId}};
    ${action}
  `;
  const result=spawnSync(process.execPath,['--input-type=module','--eval',code],{encoding:'utf8',timeout:15000,env:{...process.env,NODE_OPTIONS:''}});
  assert.equal(result.error,undefined); assert.equal(result.signal,null);
  assert.equal(result.stderr,'');
  return result;
}

for(const point of ['BEFORE_INTENT','AFTER_INTENT','AFTER_COMMIT','AFTER_INSERT']) {
  test(`pre-freeze abrupt process exit ${point}: disk-only restart remains fail-closed`,t=>{
    const s=setup(t);
    const result=child(s,`
      const runtime=createCycleEvidenceRuntime({...options,fault:p=>{if(p===${JSON.stringify(point)})process.exit(73);}});
      runtime.recover(); runtime.openMonitorCycle(cycleId);
      runtime.commitRecord(runtime.beginCycleWriter(cycleId),input);
    `);
    assert.equal(result.status,73);
    const committed=['AFTER_COMMIT','AFTER_INSERT'].includes(point);
    assert.equal(s.store().list().length,point==='AFTER_INSERT'?1:0);
    const history=s.store(), next=s.runtime(history);
    assert.throws(()=>next.recover(),/EVIDENCE_STORAGE_FAILURE/);
    assert.equal(next.health().paused,true); assert.equal(history.list().length,committed?1:0);
    assert.equal(s.store().list().length,committed?1:0);
    assert.throws(()=>next.openMonitorCycle('autonomous-paper-monitor-v1:new'));
    assert.equal(createCycleEvidenceJournal({directory:s.journalDir}).readManifest(cycleId).state,'OPEN');
  });
}

test('pre-freeze abrupt exit inside seal commit preserves WAL but leaves stale lock; restart cannot steal it',t=>{
  const s=setup(t);
  assert.equal(child(s,`
    const journal=createCycleEvidenceJournal({directory,fault:(p,type)=>{if(p==='AFTER_WAL_COMMIT'&&type==='CYCLE_SEAL_COMMIT')process.exit(73);}});
    const runtime=createCycleEvidenceRuntime({...options,journal}); runtime.recover(); runtime.openMonitorCycle(cycleId);
    const writer=runtime.beginCycleWriter(cycleId); runtime.commitRecord(writer,input);runtime.endCycleWriter(writer);
    runtime.sealMonitorCycle(cycleId);
  `).status,73);
  const bytes=fs.readFileSync(path.join(s.journalDir,'journal.jsonl'));
  assert.equal(JSON.parse(bytes.toString().trim().split('\n').at(-1)).type,'CYCLE_SEAL_COMMIT');
  assert.equal(fs.existsSync(path.join(s.journalDir,'writer.lock')),true);
  const next=s.runtime(s.store()); assert.throws(()=>next.recover()); assert.equal(next.health().paused,true);
  assert.deepEqual(fs.readFileSync(path.join(s.journalDir,'journal.jsonl')),bytes);
});

for(const state of ['SEALED','OPEN','INVALID']) {
  test(`pre-freeze disk-only restart with ${state} cycle`,t=>{
    const s=setup(t);
    assert.equal(child(s,`
      const runtime=createCycleEvidenceRuntime(options);runtime.recover();runtime.openMonitorCycle(cycleId);
      const writer=runtime.beginCycleWriter(cycleId);runtime.commitRecord(writer,input);runtime.endCycleWriter(writer);
      ${state==='SEALED'?'runtime.sealMonitorCycle(cycleId);':state==='INVALID'?'runtime.invalidateMonitorCycle(cycleId);':''}
      process.exit(73);
    `).status,73);
    const next=s.runtime(s.store());
    if(state==='SEALED')assert.deepEqual(next.recover().sealedCycleIds,[cycleId]);
    else {assert.throws(()=>next.recover());assert.equal(next.health().paused,true);}
    assert.equal(s.store().list().length,1);
  });
}

test('pre-freeze actual history temporary-file collision after WAL commit is recoverable without phantom records',t=>{
  const s=setup(t);
  assert.equal(child(s,`
    const runtime=createCycleEvidenceRuntime(options);runtime.recover();runtime.openMonitorCycle(cycleId);
    fs.mkdirSync(historyPath+'.tmp');
    assert.throws(()=>runtime.commitRecord(runtime.beginCycleWriter(cycleId),input));
    assert.equal(store.list().length,0);assert.equal(runtime.health().paused,true);
  `).status,0);
  fs.rmdirSync(s.historyPath+'.tmp'); // Test-owned obstacle only, not production recovery.
  const history=s.store();assert.throws(()=>s.runtime(history).recover());
  assert.equal(s.store().list().length,1);
});

test('pre-freeze real WAL append open failure quarantines and blocks restart',t=>{
  const s=setup(t);
  assert.equal(child(s,`
    const runtime=createCycleEvidenceRuntime(options);runtime.recover();runtime.openMonitorCycle(cycleId);
    const writer=runtime.beginCycleWriter(cycleId);
    const open=fs.openSync;
    fs.openSync=function(file,flags,...rest){
      if(file===path.join(directory,'journal.jsonl')&&flags==='a'){const e=new Error('injected IO failure');e.code='EIO';throw e;}
      return open.call(this,file,flags,...rest);
    };
    try{assert.throws(()=>runtime.commitRecord(writer,input));}finally{fs.openSync=open;}
    assert.equal(runtime.health().paused,true);assert.equal(store.list().length,0);
    assert.equal(fs.existsSync(path.join(directory,'INVALID')),true);
  `).status,0);
  const next=s.runtime(s.store());assert.throws(()=>next.recover());assert.equal(next.health().paused,true);
});

test('pre-freeze disk-only settled recovery preserves history bytes',t=>{
  const s=setup(t);
  assert.equal(child(s,`
    const runtime=createCycleEvidenceRuntime(options);runtime.recover();runtime.openMonitorCycle(cycleId);
    const writer=runtime.beginCycleWriter(cycleId),record=runtime.commitRecord(writer,input);runtime.endCycleWriter(writer);runtime.sealMonitorCycle(cycleId);
    paperMutationPort.confirmPaperExecution(record.id,{referenceTimestamp:at,referencePrice:1.1});paperMutationPort.settlePaperOutcome(record.id,'WIN');
  `).status,0);
  const bytes=fs.readFileSync(s.historyPath);s.runtime(s.store()).recover();assert.deepEqual(fs.readFileSync(s.historyPath),bytes);
});

test('pre-freeze duplicate recordId in distinct creation operation invalidates without extra history',t=>{
  const s=setup(t),history=s.store(),runtime=s.runtime(history);runtime.recover();runtime.openMonitorCycle(cycleId);
  const writer=runtime.beginCycleWriter(cycleId),input={decision:{direction:'WAIT'},context:{decisionId:'one'}};
  runtime.commitRecord(writer,input);
  assert.throws(()=>runtime.commitRecord(writer,{...input,context:{decisionId:'two'}}));
  assert.equal(runtime.health().paused,true);assert.equal(history.list().length,1);
  assert.equal(createCycleEvidenceJournal({directory:s.journalDir}).readManifest(cycleId).state,'INVALID');
});
