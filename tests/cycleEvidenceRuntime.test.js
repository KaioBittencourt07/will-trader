import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHistoryStore } from '../learning/src/historyStore.js';
import { createCycleEvidenceJournal } from '../learning/src/cycleEvidenceJournal.js';
import { createCycleEvidenceRuntime } from '../learning/src/cycleEvidenceRuntime.js';
import { createAutonomousPaperMonitor } from '../learning/src/autonomousPaperMonitor.js';
import { withCycleEvidenceRequest } from '../backend/src/cycleEvidenceRequest.js';
import opportunitiesRouter from '../backend/src/routes/opportunities.js';

const at='2026-09-18T00:00:00.000Z', ms=Date.parse(at), cycleId=`autonomous-paper-monitor-v1:${Math.floor(ms/60000)}`;
const input={decision:{direction:'BUY',releaseEligible:true,clickTime:at},data:{asset:'EUR/USD',price:1.1},context:{decisionId:'d1',monitorCycleId:cycleId}};
function setup(t) {
  const directory=fs.mkdtempSync(path.join(tmpdir(),'will-evidence-runtime-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  let n=0;
  const store=createHistoryStore({filePath:path.join(directory,'history.json'),id:()=>`r${++n}`,now:()=>at});
  const journalDir=path.join(directory,'wal');
  const journal=createCycleEvidenceJournal({directory:journalDir});
  const runtime=(extra={})=>createCycleEvidenceRuntime({directory:journalDir,protocolId:'synthetic-protocol',campaignId:'synthetic-campaign',historyStore:store,now:()=>at,...extra});
  const monitor=(controller,runCycle,extra={})=>createAutonomousPaperMonitor({enabled:true,filePath:path.join(directory,'monitor.json'),now:()=>ms,runCycle,cycleEvidence:controller,...extra});
  return {directory,store,journal,runtime,monitor};
}
function create(controller) {
  const token=controller.beginCycleWriter(cycleId);
  try { return controller.commitRecord(token,input); }
  finally { controller.endCycleWriter(token); }
}
test('prepared records are invisible until inserted; exact replay only and decision collisions fail closed',t=>{
  const s=setup(t), r=s.store.prepareDecisionRecord(input);
  assert.equal(s.store.list().length,0); assert.ok(r.id);
  s.store.insertPreparedRecord(r); assert.equal(s.store.insertPreparedRecord(r).idempotent,true);
  assert.throws(()=>s.store.insertPreparedRecord({...r,asset:'OTHER'}),/DUPLICATE/);
  assert.throws(()=>s.store.insertPreparedRecord({...r,id:'different'}),/DUPLICATE/);
  assert.equal(s.store.list().length,1);
});
for(const point of ['BEFORE_INTENT','AFTER_INTENT','AFTER_COMMIT','AFTER_INSERT']) {
  test(`fault ${point}: no history before WAL commit; recovery inserts only confirmed missing record`,t=>{
    const s=setup(t), c=s.runtime({fault:p=>{if(p===point) throw new Error('crash');}});
    c.recover(); c.openMonitorCycle(cycleId); const token=c.beginCycleWriter(cycleId);
    assert.throws(()=>c.commitRecord(token,input),/STORAGE_FAILURE/);
    assert.equal(s.store.list().length,point==='AFTER_INSERT'?1:0);
    const next=s.runtime(); assert.throws(()=>next.recover(),/STORAGE_FAILURE/);
    assert.equal(s.store.list().length,['AFTER_COMMIT','AFTER_INSERT'].includes(point)?1:0);
    assert.equal(next.health().paused,true);
    const again=s.runtime(); assert.throws(()=>again.recover());
    assert.equal(s.store.list().length,['AFTER_COMMIT','AFTER_INSERT'].includes(point)?1:0);
    assert.equal(s.journal.readManifest(cycleId).state,'OPEN');
  });
}
test('normal monitor seals before durable scheduler termination',async t=>{
  const s=setup(t), c=s.runtime(), m=s.monitor(c,async()=>{create(c);return {ok:true};});
  const r=await m.runOnce(); assert.equal(r.status,'COMPLETED');
  assert.equal(s.journal.readManifest(cycleId).state,'SEALED');
  assert.ok(JSON.parse(fs.readFileSync(path.join(s.directory,'monitor.json'),'utf8')).completedCycleIds.includes(cycleId));
});
test('seal commit crash recovers scheduler termination without repeating cycle',async t=>{
  const s=setup(t); let crash=true;
  const journal=createCycleEvidenceJournal({directory:path.join(s.directory,'wal'),fault:(point,type)=>{if(crash && point==='AFTER_WAL_COMMIT' && type==='CYCLE_SEAL_COMMIT') throw new Error('crash');}});
  const c=s.runtime({journal}), m=s.monitor(c,async()=>{create(c);return {ok:true};});
  assert.equal((await m.runOnce()).status,'PAUSED'); crash=false;
  const next=s.runtime(); let calls=0;
  assert.equal((await s.monitor(next,async()=>{calls++;return {ok:true};}).runOnce()).status,'IDEMPOTENT');
  assert.equal(calls,0); assert.equal(s.store.list().length,1);
});
for(const throwing of [false,true]) {
  test(`runCycle ${throwing?'throws':'ok=false'} after creation invalidates before scheduler termination`,async t=>{
    const s=setup(t), c=s.runtime();
    const r=await s.monitor(c,async()=>{create(c);if(throwing)throw new Error('provider failure');return {ok:false};}).runOnce();
    assert.equal(r.status,'SKIPPED_INVALID_CYCLE'); assert.equal(s.journal.readManifest(cycleId).state,'INVALID');
    assert.equal(s.store.list()[0].campaignId,'synthetic-campaign');
    assert.ok(JSON.parse(fs.readFileSync(path.join(s.directory,'monitor.json'),'utf8')).completedCycleIds.includes(cycleId));
  });
}
test('active writer blocks monitor seal and no scheduler completion is persisted',async t=>{
  const s=setup(t), c=s.runtime();
  const r=await s.monitor(c,async()=>{c.beginCycleWriter(cycleId);return {ok:true};}).runOnce();
  assert.equal(r.status,'PAUSED'); assert.equal(s.journal.readManifest(cycleId).state,'OPEN');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.directory,'monitor.json'),'utf8')).completedCycleIds,[]);
});
test('history insertion failure after commit pauses and recovery materializes creation',async t=>{
  const s=setup(t), broken={...s.store,insertPreparedRecord:()=>{throw new Error('disk');}},c=s.runtime({historyStore:broken});
  assert.equal((await s.monitor(c,async()=>{create(c);return {ok:true};}).runOnce()).status,'PAUSED');
  assert.equal(s.store.list().length,0);
  assert.throws(()=>s.runtime().recover()); assert.equal(s.store.list().length,1);
});
test('history durable write failure does not leave an in-memory phantom',t=>{
  const s=setup(t), r=s.store.prepareDecisionRecord(input);
  fs.mkdirSync(path.join(s.directory,'history.json.tmp'));
  assert.throws(()=>s.store.insertPreparedRecord(r)); assert.equal(s.store.list().length,0);
});
test('settlement preserves membership and inventory; restart never overwrites newer record',async t=>{
  const s=setup(t), c=s.runtime(); await s.monitor(c,async()=>{create(c);return {ok:true};}).runOnce();
  const m=s.journal.readManifest(cycleId), r=s.store.list()[0];
  s.store.confirmPaperExecution(r.id,{referenceTimestamp:at,referencePrice:1.1,protocolId:'forged',campaignId:'forged',cycleId:'forged',writerGeneration:99,id:'forged'});
  s.store.settle(r.id,'WIN',{protocolId:'forged',campaignId:'forged',cycleId:'forged',writerGeneration:99,id:'forged'});
  const settled=s.store.list()[0];
  for(const k of ['id','protocolId','campaignId','cycleId','writerGeneration']) assert.equal(settled[k],r[k]);
  const bytes=fs.readFileSync(path.join(s.directory,'history.json')); s.runtime().recover();
  assert.deepEqual(fs.readFileSync(path.join(s.directory,'history.json')),bytes);
  assert.equal(s.journal.readManifest(cycleId).canonicalDigest,m.canonicalDigest);
});
function response() {
  return {code:200,body:null,status(n){this.code=n;return this;},json(value){this.body=value;return this;}};
}
test('request ignores forged query membership and ends writer before response',async t=>{
  const s=setup(t), c=s.runtime(); c.recover(); c.openMonitorCycle(cycleId);
  const handler=withCycleEvidenceRequest(async(req,res)=>res.json({ok:true,record:req.cycleEvidenceRecord(input)}));
  const res=response();
  await handler({query:{monitorCycleId:cycleId,protocolId:'forged',campaignId:'forged',writerGeneration:'999'},app:{locals:{cycleEvidenceRuntime:c}}},res);
  assert.equal(res.code,200); assert.equal(res.body.record.protocolId,'synthetic-protocol');
  assert.equal(res.body.record.campaignId,'synthetic-campaign'); assert.equal(res.body.record.writerGeneration,1);
  assert.equal(c.sealMonitorCycle(cycleId).state,'SEALED');
});
test('early response ends writer; pending transaction in finally blocks response and pauses',async t=>{
  const s=setup(t), c=s.runtime(); c.recover(); c.openMonitorCycle(cycleId);
  const early=response(); await withCycleEvidenceRequest(async(req,res)=>res.status(400).json({ok:false}))({query:{monitorCycleId:cycleId},app:{locals:{cycleEvidenceRuntime:c}}},early);
  assert.equal(early.code,400); assert.equal(c.sealMonitorCycle(cycleId).state,'SEALED');
  const s2=setup(t), c2=s2.runtime({fault:p=>{if(p==='AFTER_INTENT') throw new Error('crash');}}); c2.recover(); c2.openMonitorCycle(cycleId);
  const failed=response(); await withCycleEvidenceRequest(async(req,res)=>res.json(req.cycleEvidenceRecord(input)))({query:{monitorCycleId:cycleId},app:{locals:{cycleEvidenceRuntime:c2}}},failed);
  assert.equal(failed.code,503); assert.equal(c2.health().paused,true); assert.equal(s2.store.list().length,0);
});
test('disabled evidence preserves legacy request and failed-cycle behavior',async t=>{
  const s=setup(t),res=response(); let called=0;
  await withCycleEvidenceRequest(async(req,r)=>{called++;assert.equal(req.cycleEvidenceRecord,undefined);return r.json({ok:true});})({query:{monitorCycleId:cycleId,campaignId:'forged'},app:{locals:{}}},res);
  assert.equal(called,1); assert.equal(res.body.ok,true);
  const m=s.monitor(null,async()=>({ok:false})); assert.equal((await m.runOnce()).status,'SKIPPED_INVALID_CYCLE');
  assert.throws(()=>s.journal.readManifest(cycleId),/NOT_FOUND/);
  const r=s.store.recordDecision(input); assert.equal(r.protocolId,undefined);
  assert.equal(s.store.recordDecision(input).idempotent,true);
});
test('configuration cannot silently choose real protocol or campaign',t=>{
  const s=setup(t); assert.throws(()=>createCycleEvidenceRuntime({directory:path.join(s.directory,'bad'),historyStore:s.store}),/CONFIGURATION/);
});
test('real opportunities route is wrapped and closes writer on query validation failure',async t=>{
  const s=setup(t),c=s.runtime();c.recover();c.openMonitorCycle(cycleId);
  const route=opportunitiesRouter.stack.find(layer=>layer.route?.path==='/opportunities').route.stack[0].handle;
  const res=response();
  await route({query:{monitorCycleId:cycleId,assets:'@@',protocolId:'forged',campaignId:'forged',writerGeneration:'999'},app:{locals:{cycleEvidenceRuntime:c}}},res);
  assert.equal(res.code,400);assert.equal(s.store.list().length,0);assert.equal(c.sealMonitorCycle(cycleId).state,'SEALED');
});
test('late request for sealed evidence cycle never falls back to legacy',async t=>{
  const s=setup(t),c=s.runtime();c.recover();c.openMonitorCycle(cycleId);c.sealMonitorCycle(cycleId);
  let calls=0;const res=response();
  await withCycleEvidenceRequest(async()=>{calls++;})({query:{monitorCycleId:cycleId},app:{locals:{cycleEvidenceRuntime:c}}},res);
  assert.equal(res.code,503);assert.equal(calls,0);
});
test('scheduler persistence failure after seal can recover termination',async t=>{
  const s=setup(t),c=s.runtime(),block=path.join(s.directory,'monitor.json.tmp');
  const m=s.monitor(c,async()=>{create(c);fs.mkdirSync(block);return {ok:true};});
  assert.equal((await m.runOnce()).status,'PAUSED');assert.equal(s.journal.readManifest(cycleId).state,'SEALED');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.directory,'monitor.json'),'utf8')).completedCycleIds,[]);
  fs.rmdirSync(block);
  assert.equal((await s.monitor(s.runtime(),async()=>{throw new Error('must not run');}).runOnce()).status,'IDEMPOTENT');
});
test('failed durable INVALID cannot publish scheduler termination',async t=>{
  const s=setup(t),journal=createCycleEvidenceJournal({directory:path.join(s.directory,'wal'),fault:(p,type)=>{if(p==='BEFORE_APPEND'&&type==='CYCLE_INVALID_COMMIT')throw new Error('disk');}});
  const c=s.runtime({journal}); assert.equal((await s.monitor(c,async()=>({ok:false})).runOnce()).status,'PAUSED');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.directory,'monitor.json'),'utf8')).completedCycleIds,[]);
});
test('recovery insertion failure blocks new cycles',t=>{
  const s=setup(t),c=s.runtime({fault:p=>{if(p==='AFTER_COMMIT')throw new Error('crash');}});
  c.recover();c.openMonitorCycle(cycleId);assert.throws(()=>create(c));
  const next=s.runtime({historyStore:{...s.store,insertPreparedRecord:()=>{throw new Error('disk');}}});
  assert.throws(()=>next.recover());assert.equal(next.health().paused,true);
  assert.throws(()=>next.openMonitorCycle('autonomous-paper-monitor-v1:next'));assert.equal(s.store.list().length,0);
});
test('recovery identity conflict blocks new cycles without changing existing record',t=>{
  const s=setup(t),c=s.runtime();c.recover();c.openMonitorCycle(cycleId);const r=create(c);
  const conflicting={...r,campaignId:'other'},next=s.runtime({historyStore:{...s.store,list:()=>[conflicting]}});
  assert.throws(()=>next.recover());assert.equal(next.health().paused,true);assert.equal(conflicting.campaignId,'other');
});
