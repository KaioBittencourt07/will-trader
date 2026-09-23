import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const VERSION='paper-cycle-evidence-lock-v1';
let cachedSelf=null;
const fail=()=>{throw new Error('JOURNAL_LOCKED');};

// OS process birth identity is required. A PID alone or an elapsed-time lease
// can never prove that the owner of a persistent lock is dead.
export function inspectProcessInstance(pid){
  if(!Number.isSafeInteger(pid)||pid<1)return {state:'AMBIGUOUS'};
  if(pid===process.pid&&cachedSelf)return cachedSelf;
  let result={state:'AMBIGUOUS'};
  try{
    if(process.platform==='win32'){
      const script=`try { $p=[System.Diagnostics.Process]::GetProcessById(${pid}); $p.StartTime.ToUniversalTime().Ticks } catch [System.ArgumentException] { 'DEAD' } catch { 'AMBIGUOUS' }`;
      const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',timeout:10000,windowsHide:true}).trim();
      if(output==='DEAD')result={state:'DEAD'};
      else if(/^\d{15,20}$/.test(output))result={state:'ALIVE',birthId:`win32:${output}`};
    }else if(process.platform==='linux'){
      const stat=fs.readFileSync(`/proc/${pid}/stat`,'utf8');
      const tail=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/);
      const startTicks=tail[19],bootId=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
      if(/^\d+$/.test(startTicks)&&/^[a-f0-9-]{36}$/i.test(bootId))result={state:'ALIVE',birthId:`linux:${bootId}:${startTicks}`};
    }
  }catch(error){
    if(process.platform==='linux'&&error?.code==='ENOENT')result={state:'DEAD'};
  }
  if(pid===process.pid&&result.state==='ALIVE')cachedSelf=result;
  return result;
}

export function withEvidenceLock({directory,inspectProcess=inspectProcessInstance},fn){
  const lockPath=path.join(directory,'writer.lock'),guardPath=path.join(directory,'writer.lock.recovery');
  const identity=inspectProcess(process.pid);
  if(identity?.state!=='ALIVE'||typeof identity.birthId!=='string'||!identity.birthId)fail();
  const owner={schemaVersion:VERSION,pid:process.pid,birthId:identity.birthId,nonce:randomUUID()};
  const bytes=JSON.stringify(owner);
  function create(){
    const fd=fs.openSync(lockPath,'wx');
    try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}catch{fs.closeSync(fd);fail();}
    return fd;
  }
  let fd;
  try{fd=create();}catch(error){
    if(error?.code!=='EEXIST')throw error;
    // Only one reaper can inspect and unlink a proven-dead owner's bytes.
    try{fs.mkdirSync(guardPath);}catch{fail();}
    try{
      let observed,prior;
      try{prior=fs.readFileSync(lockPath,'utf8');observed=JSON.parse(prior);}catch{fail();}
      if(observed?.schemaVersion!==VERSION||!Number.isSafeInteger(observed.pid)||observed.pid<1||
        typeof observed.birthId!=='string'||!observed.birthId||typeof observed.nonce!=='string'||
        !/^[a-f0-9-]{36}$/i.test(observed.nonce))fail();
      const current=inspectProcess(observed.pid);
      // A reused PID is deliberately ambiguous, even though the old owner
      // has died. This trades availability for non-stealing safety.
      if(current?.state!=='DEAD')fail();
      if(fs.readFileSync(lockPath,'utf8')!==prior)fail();
      fs.unlinkSync(lockPath);
      try{fd=create();}catch{fail();}
    }finally{fs.rmdirSync(guardPath);}
  }
  try{return fn();}
  finally{
    fs.closeSync(fd);
    // Never unlink another owner's replacement lock.
    if(fs.readFileSync(lockPath,'utf8')!==bytes)fail();
    fs.unlinkSync(lockPath);
  }
}
