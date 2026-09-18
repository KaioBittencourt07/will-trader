import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { baselineCommitment } from '../backend/src/oos2rEvidence.js';
import { readOos2rFreeze } from '../backend/src/evaluateOos2r.js';
import { inspectOos2rActivation,prepareOos2rEnvironment,createPreparedOos2rRuntime,OOS2R_PROTOCOL,OOS2R_CAMPAIGN,OOS2R_START_AUTHORIZATION } from '../backend/src/oos2rActivation.js';

function fixture(t) {
  const dir=fs.mkdtempSync(path.join(tmpdir(),'will-oos2r-activation-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const rows=[{id:'synthetic-a'},{id:'synthetic-b'}],historyFile=path.join(dir,'history.json'),evidenceDirectory=path.join(dir,'new-evidence');
  fs.writeFileSync(historyFile,JSON.stringify(rows));
  // Trusted dependency injection only; no real history/IDs, no production env override.
  const freeze={...readOos2rFreeze(),...baselineCommitment(rows)},readFreeze=()=>freeze;
  let clock=Date.parse(freeze.edgeCut)+1;
  const options={historyFile,evidenceDirectory,scanRoots:[dir],readFreeze,now:()=>clock};
  const store={list:()=>structuredClone(rows),prepareDecisionRecord:()=>{throw Error('NO_RECORD_CREATION_IN_ACTIVATION');},insertPreparedRecord:()=>{throw Error('NO_HISTORY_WRITES_IN_ACTIVATION');}};
  return {dir,rows,options,freeze,readFreeze,store,clock:v=>{clock=v;}};
}
test('activation preflight is read-only and creates no directory/cycle/record',t=>{
  const s=fixture(t),before=fs.readFileSync(s.options.historyFile),files=fs.readdirSync(s.dir);
  const r=inspectOos2rActivation(s.options);assert.equal(r.ready,true);assert.equal(r.existingOos2rCycles,0);assert.equal(r.started,false);
  assert.equal(fs.existsSync(s.options.evidenceDirectory),false);assert.deepEqual(fs.readFileSync(s.options.historyFile),before);assert.deepEqual(fs.readdirSync(s.dir),files);
});
for(const kind of ['missing','duplicate','extra','replacement','protocol','campaign'])test(`activation rejects baseline ${kind}`,t=>{
  const s=fixture(t);if(kind==='missing')s.rows.pop();if(kind==='duplicate')s.rows.push(s.rows[0]);if(kind==='extra')s.rows.push({id:'extra'});
  if(kind==='replacement')s.rows[0].id='replacement';if(kind==='protocol')s.rows[0].protocolId=OOS2R_PROTOCOL;if(kind==='campaign')s.rows[0].campaignId=OOS2R_CAMPAIGN;
  fs.writeFileSync(s.options.historyFile,JSON.stringify(s.rows));assert.throws(()=>inspectOos2rActivation(s.options));assert.equal(fs.existsSync(s.options.evidenceDirectory),false);
});
for(const kind of ['empty-directory','manifest','wal','malformed'])test(`activation rejects existing ${kind}`,t=>{
  const s=fixture(t);
  if(kind==='empty-directory')fs.mkdirSync(s.options.evidenceDirectory);
  if(kind==='manifest')fs.writeFileSync(path.join(s.dir,'old.manifest.json'),JSON.stringify({protocolId:OOS2R_PROTOCOL}));
  if(kind==='wal')fs.writeFileSync(path.join(s.dir,'journal.jsonl'),JSON.stringify({payload:{campaignId:OOS2R_CAMPAIGN}})+'\n');
  if(kind==='malformed')fs.writeFileSync(path.join(s.dir,'journal.jsonl'),'{bad');
  assert.throws(()=>inspectOos2rActivation(s.options));
});
test('activation rejects wrong freeze bytes before any creation',t=>{
  const s=fixture(t),file=path.join(s.dir,'freeze.json');fs.writeFileSync(file,JSON.stringify(s.freeze));
  assert.throws(()=>inspectOos2rActivation({...s.options,readFreeze:readOos2rFreeze,freezeFile:file}),/SHA256/);
});
test('activation rejects before/equal edgeCut and unsafe/unscanned paths',t=>{
  const s=fixture(t);s.clock(Date.parse(s.freeze.edgeCut));assert.throws(()=>inspectOos2rActivation(s.options),/EDGE_CUT/);
  s.clock(Date.parse(s.freeze.edgeCut)-1);assert.throws(()=>inspectOos2rActivation(s.options));
  assert.throws(()=>inspectOos2rActivation({...s.options,evidenceDirectory:s.dir}));assert.throws(()=>inspectOos2rActivation({...s.options,scanRoots:[]}));
});
test('activation requires literal authorization and exact identities; legacy disabled remains inert',()=>{
  assert.equal(prepareOos2rEnvironment({}),null);
  const env={WILL_CYCLE_EVIDENCE_ENABLED:'true',WILL_CYCLE_EVIDENCE_PROTOCOL_ID:OOS2R_PROTOCOL,WILL_CYCLE_EVIDENCE_CAMPAIGN_ID:OOS2R_CAMPAIGN};
  assert.throws(()=>prepareOos2rEnvironment(env),/EXACT/);
  for(const patch of [{WILL_CYCLE_EVIDENCE_ENABLED:'false'},{WILL_CYCLE_EVIDENCE_PROTOCOL_ID:'wrong'},{WILL_CYCLE_EVIDENCE_CAMPAIGN_ID:'wrong'}])assert.throws(()=>prepareOos2rEnvironment({...env,WILL_OOS2R_START_AUTHORIZATION:OOS2R_START_AUTHORIZATION,...patch}),/EXACT/);
});
test('future factory reserves fresh directory; only explicit synthetic open writes authoritative WAL after cut',t=>{
  const s=fixture(t),create=()=>createPreparedOos2rRuntime({prepared:{options:s.options},historyStore:s.store,now:s.options.now,readFreeze:s.readFreeze});
  const runtime=create();assert.deepEqual(fs.readdirSync(s.options.evidenceDirectory),[]);assert.throws(create,/ALREADY_EXISTS/);
  runtime.recover();const m=runtime.openMonitorCycle('autonomous-paper-monitor-v1:synthetic-first');
  assert.equal(m.protocolId,OOS2R_PROTOCOL);assert.equal(m.campaignId,OOS2R_CAMPAIGN);assert.ok(Date.parse(m.openedAt)>Date.parse(s.freeze.edgeCut));assert.equal(m.writerGeneration,1);
  assert.equal(m.state,'OPEN');assert.deepEqual(m.recordIds,[]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.options.evidenceDirectory,'journal.jsonl'),'utf8').trim().split('\n')[0]).type,'CYCLE_OPEN_COMMIT');
});
test('clock regression or baseline mutation before first open pauses without cycle',t=>{
  for(const mode of ['clock','baseline']) {
    const s=fixture(t),r=createPreparedOos2rRuntime({prepared:{options:s.options},historyStore:s.store,now:s.options.now,readFreeze:s.readFreeze});r.recover();
    if(mode==='clock')s.clock(Date.parse(s.freeze.edgeCut));else s.rows.push({id:'unexpected'});
    assert.throws(()=>r.openMonitorCycle('autonomous-paper-monitor-v1:synthetic-first'));assert.equal(r.health().paused,true);
    assert.equal(fs.existsSync(path.join(s.options.evidenceDirectory,'journal.jsonl')),false);
  }
});
test('server checks activation before secrets/provider/history side effects and wires guarded runtime',()=>{
  const source=fs.readFileSync(new URL('../backend/src/server.js',import.meta.url),'utf8');
  assert.ok(source.indexOf('const oos2rPrepared = prepareOos2rEnvironment()')<source.indexOf('const runtimeSecrets = await hydrateRuntimeSecrets()'));
  assert.match(source,/createPreparedOos2rRuntime\(\{prepared:oos2rPrepared,historyStore:app.locals.historyStore\}\)/);
});
