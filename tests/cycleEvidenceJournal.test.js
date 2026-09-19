import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCycleEvidenceJournal } from '../learning/src/cycleEvidenceJournal.js';
import { canonicalDigest, verifyManifestAgainstHistory, validateManifest } from '../learning/src/cycleEvidenceManifest.js';

const at='2026-09-17T00:00:00.000Z', end='2026-09-17T00:01:00.000Z';
function setup(t) {
  const directory=fs.mkdtempSync(path.join(tmpdir(),'will-manifest-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  let crash=null;
  const journal=createCycleEvidenceJournal({directory,fault:(point,type)=>{if(crash===`${point}:${type}`) throw new Error('INJECTED_CRASH');}});
  const m=journal.openCycle({protocolId:'test-only',campaignId:'synthetic',cycleId:'autonomous-paper-monitor-v1:1',openedAt:at,history:[]});
  const ctx={cycleId:m.cycleId,writerGeneration:m.writerGeneration};
  const record=(id='r1')=>({id,...ctx,protocolId:m.protocolId,campaignId:m.campaignId,status:'OPEN'});
  const begin=(writerId='w1',id='r1',operationId='op1')=>{
    journal.beginWriter({...ctx,writerId});
    journal.beginRecordCreation({...ctx,writerId,operationId,record:record(id)});
  };
  const commit=(operationId='op1')=>journal.commitRecordCreation({...ctx,operationId});
  const seal=()=>journal.sealCycle({...ctx,sealedAt:end});
  return {directory,journal,m,ctx,record,begin,commit,seal,crash:value=>{crash=value;}};
}
test('durable OPEN precedes writers and creation; IDs are pre-generated',t=>{
  const s=setup(t); assert.equal(s.journal.readManifest(s.ctx.cycleId).expectedRecordCount,0);
  s.journal.beginWriter({...s.ctx,writerId:'w1'});
  assert.throws(()=>s.journal.beginRecordCreation({...s.ctx,writerId:'w1',operationId:'o',record:{...s.record(),id:undefined}}));
  const events=fs.readFileSync(path.join(s.directory,'journal.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events[0].type,'CYCLE_OPEN_COMMIT');
});
test('operation replay is idempotent and does not increment inventory twice',t=>{
  const s=setup(t); s.begin(); s.commit();
  s.journal.beginRecordCreation({...s.ctx,writerId:'w1',operationId:'op1',record:s.record()}); s.commit();
  assert.equal(s.journal.readManifest(s.ctx.cycleId).expectedRecordCount,1);
});
test('two interleaved writers across journal instances preserve both creations',t=>{
  const s=setup(t), other=createCycleEvidenceJournal({directory:s.directory});
  s.begin(); other.beginWriter({...s.ctx,writerId:'w2'});
  other.beginRecordCreation({...s.ctx,writerId:'w2',operationId:'op2',record:s.record('r2')});
  s.commit('op2'); s.commit();
  assert.deepEqual(s.journal.readManifest(s.ctx.cycleId).recordIds,['r2','r1']);
});
test('old generation is rejected and cycle invalidated without reopening',t=>{
  const s=setup(t); assert.throws(()=>s.journal.beginWriter({...s.ctx,writerGeneration:99,writerId:'w'}),/GENERATION/);
  assert.equal(s.journal.readManifest(s.ctx.cycleId).state,'INVALID');
  assert.throws(()=>s.begin(),/CYCLE_NOT_OPEN/);
});
test('incompatible duplicate invalidates cycle',t=>{
  const s=setup(t); s.begin();
  assert.throws(()=>s.journal.beginRecordCreation({...s.ctx,writerId:'w1',operationId:'op1',record:s.record('different')}),/DUPLICATE/);
  assert.equal(s.journal.readManifest(s.ctx.cycleId).state,'INVALID');
});
for (const point of ['BEFORE_APPEND','AFTER_WAL_COMMIT','AFTER_PROJECTION']) {
  test(`creation crash at ${point}: recovery materializes only confirmed creation`,t=>{
    const s=setup(t); s.begin(); s.crash(`${point}:RECORD_CREATE_COMMIT`);
    assert.throws(()=>s.commit(),/INJECTED_CRASH/);
    const restarted=createCycleEvidenceJournal({directory:s.directory});
    const first=restarted.recover({history:[]});
    assert.equal(first.records.length,point==='BEFORE_APPEND'?0:1);
    const second=restarted.recover({history:first.records});
    assert.deepEqual(second.records,first.records); assert.deepEqual(second.materializedRecordIds,[]);
    assert.deepEqual(second.sealedCycleIds,[]);
  });
}
test('seal blocks active writers and closes admission immediately',t=>{
  const s=setup(t); s.journal.beginWriter({...s.ctx,writerId:'w'});
  assert.throws(s.seal,/SEAL_PENDING/);
  assert.throws(()=>s.journal.beginWriter({...s.ctx,writerId:'new'}),/WRITER_BLOCKED/);
  s.journal.endWriter({...s.ctx,writerId:'w'}); assert.equal(s.seal().state,'SEALED');
});
test('pending transaction blocks writer end and seal; confirmed intent may drain',t=>{
  const s=setup(t); s.begin(); assert.throws(s.seal,/SEAL_PENDING/);
  assert.throws(()=>s.journal.endWriter({...s.ctx,writerId:'w1'}),/WRITER_PENDING/);
  s.commit(); s.journal.endWriter({...s.ctx,writerId:'w1'}); assert.equal(s.seal().state,'SEALED');
});
test('crash after seal commit restores manifest and termination evidence, never infers seal',t=>{
  const s=setup(t); s.begin(); s.commit(); s.journal.endWriter({...s.ctx,writerId:'w1'});
  s.crash('AFTER_WAL_COMMIT:CYCLE_SEAL_COMMIT'); assert.throws(s.seal,/INJECTED_CRASH/);
  const j=createCycleEvidenceJournal({directory:s.directory}), r=j.recover({history:[]});
  assert.deepEqual(r.sealedCycleIds,[s.ctx.cycleId]);
  assert.equal(Object.hasOwn(r,'completedCycleIds'),false);
  assert.equal(j.readManifest(s.ctx.cycleId).state,'SEALED');
  assert.throws(()=>j.beginWriter({...s.ctx,writerId:'late'}),/CYCLE_NOT_OPEN/);
});
test('crash before seal commit cannot create completion',t=>{
  const s=setup(t); s.crash('BEFORE_APPEND:CYCLE_SEAL_COMMIT'); assert.throws(s.seal);
  assert.deepEqual(createCycleEvidenceJournal({directory:s.directory}).recover({history:[]}).sealedCycleIds,[]);
});
test('newer settlement preserved byte-for-byte by recovery and inventory unchanged',t=>{
  const s=setup(t); s.begin(); const r=s.commit(); s.journal.endWriter({...s.ctx,writerId:'w1'}); const m=s.seal();
  const settled={...r,status:'CLOSED',settledAt:end,outcome:'WIN',newerField:{value:42}};
  const before=JSON.stringify(settled), recovered=s.journal.recover({history:[settled]});
  assert.equal(JSON.stringify(recovered.records[0]),JSON.stringify(JSON.parse(before)));
  assert.deepEqual(recovered.records[0],settled); assert.equal(JSON.stringify(settled),before);
  assert.equal(s.journal.readManifest(m.cycleId).canonicalDigest,m.canonicalDigest);
  assert.equal(verifyManifestAgainstHistory(m,[settled]).complete,true);
});
test('membership mutation or duplicate existing history invalidates recovery',t=>{
  const s=setup(t); s.begin(); const r=s.commit();
  assert.throws(()=>s.journal.recover({history:[{...r,writerGeneration:100}]}),/IDENTITY/);
  assert.equal(s.journal.readManifest(s.ctx.cycleId).state,'INVALID');
});
for(const mode of ['truncated','corrupted','sequence']) {
  test(`WAL ${mode} is quarantined, never automatically repaired`,t=>{
    const s=setup(t), file=path.join(s.directory,'journal.jsonl'), before=fs.readFileSync(file,'utf8');
    const changed=mode==='truncated'?before.slice(0,-2):mode==='corrupted'?before.replace('test-only','tampered'):before+before;
    fs.writeFileSync(file,changed);
    assert.throws(()=>s.journal.recover({history:[]}),/JOURNAL_INVALID/);
    assert.throws(()=>s.journal.readManifest(s.ctx.cycleId),/JOURNAL_INVALID/);
    assert.equal(fs.readFileSync(file,'utf8'),changed);
  });
}
test('manifest digest deterministic, no performance fields, and exact inventory verified',t=>{
  const s=setup(t); s.begin(); const r=s.commit(); s.journal.endWriter({...s.ctx,writerId:'w1'}); const m=s.seal();
  assert.equal(canonicalDigest({...m,recordIds:[...m.recordIds].reverse()}),m.canonicalDigest);
  assert.doesNotMatch(JSON.stringify(m),/outcome|WIN|LOSS|TIE|price|momentum|score|confidence|bootstrap|expectancy/);
  assert.ok(verifyManifestAgainstHistory(m,[]).reasons.includes('MISSING_RECORD'));
  assert.ok(verifyManifestAgainstHistory(m,[r,{...r,id:'extra'}]).reasons.includes('EXTRA_RECORD'));
  assert.ok(verifyManifestAgainstHistory(m,[r,r]).reasons.includes('DUPLICATE_RECORD'));
  assert.ok(verifyManifestAgainstHistory(m,[r]).reasons.includes('PENDING_RECORD'));
  assert.throws(()=>validateManifest({...m,canonicalDigest:'bad'}));
});
test('legacy records never receive backfill or new membership',t=>{
  const s=setup(t), history=[{id:'legacy',metadata:{context:{monitorCycleId:'autonomous-paper-monitor-v1:old'}}}];
  assert.throws(()=>s.journal.openCycle({protocolId:'p',campaignId:'c',cycleId:'autonomous-paper-monitor-v1:old',openedAt:at,history}),/NO_BACKFILL/);
  assert.deepEqual(s.journal.recover({history}).records,history);
});
test('exclusive lock blocks a competing process rather than stealing ownership',t=>{
  const s=setup(t); fs.writeFileSync(path.join(s.directory,'writer.lock'),'simulated crashed owner');
  assert.throws(()=>s.journal.recover({history:[]}),/JOURNAL_LOCKED/);
});
test('foundation has no runtime or broker capability',()=>{
  const source=fs.readFileSync(new URL('../learning/src/cycleEvidenceJournal.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/from ['"].*(?:historyStore|autonomousPaperMonitor|broker|server)|fetch\(|listen\(/);
});
test('projection digest mismatch invalidates instead of silently repairing',t=>{
  const s=setup(t), file=fs.readdirSync(s.directory).find(name=>name.endsWith('.manifest.json'));
  const location=path.join(s.directory,file), m=JSON.parse(fs.readFileSync(location,'utf8'));
  fs.writeFileSync(location,JSON.stringify({...m,canonicalDigest:'corrupt'}));
  assert.throws(()=>s.journal.recover({history:[]}),/PROJECTION_INVALID/);
  assert.equal(s.journal.readManifest(s.ctx.cycleId).state,'INVALID');
});
test('extra cycle history cannot be silently adopted by recovery',t=>{
  const s=setup(t); s.begin(); const r=s.commit();
  assert.throws(()=>s.journal.recover({history:[r,s.record('extra')]}),/INVENTORY_CONFLICT/);
  assert.equal(s.journal.readManifest(s.ctx.cycleId).state,'INVALID');
});
test('digest ordering is independent of inventory insertion order',t=>{
  const s=setup(t); s.begin(); s.commit(); s.begin('w2','r2','op2'); s.commit('op2');
  const m=s.journal.readManifest(s.ctx.cycleId);
  assert.equal(canonicalDigest(m),canonicalDigest({...m,recordIds:[...m.recordIds].reverse()}));
});
test('terminal settlement requires explicit allowed label, CLOSED and valid timestamp',t=>{
  const s=setup(t); s.begin(); const r=s.commit(); s.journal.endWriter({...s.ctx,writerId:'w1'}); const m=s.seal();
  for (const outcome of ['WIN','LOSS','TIE','DATA_INVALID']) {
    assert.equal(verifyManifestAgainstHistory(m,[{...r,status:'CLOSED',settledAt:end,outcome}]).complete,true);
  }
  for (const patch of [{outcome:null},{outcome:undefined},{outcome:'UNKNOWN'},
    {settledAt:null},{settledAt:'bad'},{status:'OPEN'}]) {
    const result=verifyManifestAgainstHistory(m,[{...r,status:'CLOSED',settledAt:end,outcome:'WIN',...patch}]);
    assert.equal(result.complete,false); assert.ok(result.reasons.includes('PENDING_RECORD'));
  }
});
test('zero-length WAL with projection quarantines recovery, reads and mutations without generation reset',t=>{
  const s=setup(t), file=path.join(s.directory,'journal.jsonl');
  const projection=path.join(s.directory,fs.readdirSync(s.directory).find(name=>name.endsWith('.manifest.json')));
  const before=fs.readFileSync(projection);
  fs.writeFileSync(file,'');
  assert.throws(()=>s.journal.recover({history:[]}),/JOURNAL_INVALID/);
  const restarted=createCycleEvidenceJournal({directory:s.directory});
  assert.throws(()=>restarted.readManifest(s.ctx.cycleId),/JOURNAL_INVALID/);
  assert.throws(()=>restarted.openCycle({protocolId:'p',campaignId:'c',cycleId:'autonomous-paper-monitor-v1:2',openedAt:at,history:[]}),/JOURNAL_INVALID/);
  assert.throws(()=>restarted.beginWriter({...s.ctx,writerId:'w'}),/JOURNAL_INVALID/);
  assert.deepEqual(fs.readFileSync(projection),before); assert.equal(fs.statSync(file).size,0);
  assert.equal(JSON.parse(before).writerGeneration,s.ctx.writerGeneration);
});
