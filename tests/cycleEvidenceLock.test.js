import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {withEvidenceLock} from '../learning/src/cycleEvidenceLock.js';

const moduleUrl=new URL('../learning/src/cycleEvidenceLock.js',import.meta.url).href;
function directory(t){const value=fs.mkdtempSync(path.join(tmpdir(),'will-lock-'));t.after(()=>fs.rmSync(value,{recursive:true,force:true}));return value;}
function owner(pid,birthId='old-birth'){return {schemaVersion:'paper-cycle-evidence-lock-v1',pid,birthId,nonce:'00000000-0000-4000-8000-000000000001'};}
function lock(directory,value){fs.writeFileSync(path.join(directory,'writer.lock'),typeof value==='string'?value:JSON.stringify(value));}
const alive=pid=>({state:'ALIVE',birthId:pid===process.pid?'current-birth':'old-birth'});
test('live process instance owns lock and cannot be stolen',t=>{
  const dir=directory(t);lock(dir,owner(process.pid,'current-birth'));
  assert.throws(()=>withEvidenceLock({directory:dir,inspectProcess:alive},()=>{}),/JOURNAL_LOCKED/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'writer.lock'),'utf8')).pid,process.pid);
});
test('verified dead owner is recovered once, then normal exclusive acquisition remains idempotent',t=>{
  const dir=directory(t);lock(dir,owner(999999));
  const inspect=pid=>pid===process.pid?{state:'ALIVE',birthId:'current-birth'}:{state:'DEAD'};
  assert.equal(withEvidenceLock({directory:dir,inspectProcess:inspect},()=>42),42);
  assert.equal(withEvidenceLock({directory:dir,inspectProcess:inspect},()=>43),43);
  assert.equal(fs.existsSync(path.join(dir,'writer.lock')),false);
});
test('malformed lock, ambiguous owner, reused PID and competing reaper fail closed',t=>{
  for(const value of ['not-json',owner(999999)]){
    const dir=directory(t);lock(dir,value);
    const inspect=pid=>pid===process.pid?{state:'ALIVE',birthId:'current-birth'}:{state:'AMBIGUOUS'};
    assert.throws(()=>withEvidenceLock({directory:dir,inspectProcess:inspect},()=>{}),/JOURNAL_LOCKED/);
    assert.equal(fs.existsSync(path.join(dir,'writer.lock')),true);
  }
  const reused=directory(t);lock(reused,owner(999999));
  assert.throws(()=>withEvidenceLock({directory:reused,inspectProcess:pid=>({state:'ALIVE',birthId:pid===process.pid?'current-birth':'new-birth'})},()=>{}),/JOURNAL_LOCKED/);
  const guarded=directory(t);lock(guarded,owner(999999));
  assert.equal(withEvidenceLock({directory:guarded,inspectProcess:pid=>pid===process.pid?{state:'ALIVE',birthId:'current-birth'}:{state:'DEAD'}},()=>true),true);
});
for(const boundary of ['BEFORE_STALE_LOCK_REMOVAL','AFTER_STALE_LOCK_REMOVAL']){
  test(`reaper hard exit ${boundary} releases OS mutex and next restart is safe`,t=>{
    const dir=directory(t);lock(dir,owner(999999));
    const code=`import {withEvidenceLock} from ${JSON.stringify(moduleUrl)};withEvidenceLock({directory:${JSON.stringify(dir)},reaperFault:p=>{if(p===${JSON.stringify(boundary)})process.exit(73);}},()=>{});`;
    const child=spawnSync(process.execPath,['--input-type=module','--eval',code],{encoding:'utf8',timeout:15000,env:{...process.env,NODE_OPTIONS:''}});
    assert.equal(child.status,73);assert.equal(child.stderr,'');
    assert.equal(fs.existsSync(path.join(dir,'writer.lock')),true);
    assert.equal(withEvidenceLock({directory:dir},()=>42),42);
    assert.equal(withEvidenceLock({directory:dir},()=>43),43);
    assert.equal(fs.existsSync(path.join(dir,'writer.lock')),false);
  });
}
test('OS reaper helper death after unlink leaves no authoritative lock or guard',t=>{
  const dir=directory(t);lock(dir,owner(999999));
  assert.throws(()=>withEvidenceLock({directory:dir,helperFaultPoint:'AFTER_STALE_LOCK_REMOVAL'},()=>{}),/JOURNAL_LOCKED/);
  assert.equal(fs.existsSync(path.join(dir,'writer.lock')),false);
  assert.equal(withEvidenceLock({directory:dir},()=>true),true);
});
test('abrupt process exit leaves a verifiably dead lock that a restart reclaims',t=>{
  const dir=directory(t);
  const code=`import {withEvidenceLock} from ${JSON.stringify(moduleUrl)};withEvidenceLock({directory:${JSON.stringify(dir)}},()=>process.exit(73));`;
  const child=spawnSync(process.execPath,['--input-type=module','--eval',code],{encoding:'utf8',timeout:15000,env:{...process.env,NODE_OPTIONS:''}});
  assert.equal(child.status,73);assert.equal(child.stderr,'');
  const stale=JSON.parse(fs.readFileSync(path.join(dir,'writer.lock'),'utf8'));
  assert.ok(stale.pid>0);assert.ok(stale.birthId);
  assert.equal(withEvidenceLock({directory:dir},()=>true),true);
  assert.equal(fs.existsSync(path.join(dir,'writer.lock')),false);
});
test('two real processes cannot simultaneously own one journal directory',t=>{
  const dir=directory(t);
  const code=`import {withEvidenceLock} from ${JSON.stringify(moduleUrl)};try{withEvidenceLock({directory:${JSON.stringify(dir)}},()=>{});process.exit(0);}catch(e){process.exit(e.message==='JOURNAL_LOCKED'?73:74);}`;
  withEvidenceLock({directory:dir},()=>{
    const child=spawnSync(process.execPath,['--input-type=module','--eval',code],{encoding:'utf8',timeout:15000,env:{...process.env,NODE_OPTIONS:''}});
    assert.equal(child.status,73);assert.equal(child.stderr,'');
  });
  assert.equal(spawnSync(process.execPath,['--input-type=module','--eval',code],{encoding:'utf8',timeout:15000,env:{...process.env,NODE_OPTIONS:''}}).status,0);
});
test('competing stale-lock reapers cannot both own the journal',async t=>{
  const dir=directory(t),marker=path.join(dir,'first-acquired');lock(dir,owner(999999));
  const code=`import fs from 'node:fs';import {withEvidenceLock} from ${JSON.stringify(moduleUrl)};
    try{withEvidenceLock({directory:${JSON.stringify(dir)}},()=>{fs.writeFileSync(${JSON.stringify(marker)},'READY');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,8000)});process.exit(0)}
    catch(e){process.exit(e.message==='JOURNAL_LOCKED'?73:74)}`;
  const first=spawn(process.execPath,['--input-type=module','--eval',code],{stdio:'ignore',env:{...process.env,NODE_OPTIONS:''}});
  const until=Date.now()+10000;
  while(!fs.existsSync(marker)&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(fs.existsSync(marker),true);
  const second=spawnSync(process.execPath,['--input-type=module','--eval',
    `import {withEvidenceLock} from ${JSON.stringify(moduleUrl)};try{withEvidenceLock({directory:${JSON.stringify(dir)}},()=>{});process.exit(0)}catch(e){process.exit(e.message==='JOURNAL_LOCKED'?73:74)}`],
    {encoding:'utf8',timeout:15000,env:{...process.env,NODE_OPTIONS:''}});
  assert.equal(second.status,73);
  assert.equal(first.exitCode??(await once(first,'exit'))[0],0);
  assert.equal(withEvidenceLock({directory:dir},()=>true),true);
});
