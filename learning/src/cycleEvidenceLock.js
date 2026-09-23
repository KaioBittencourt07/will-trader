import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';

const VERSION='paper-cycle-evidence-lock-v1';
let cachedSelf=null;
const fail=()=>{throw new Error('JOURNAL_LOCKED');};
// The OS helper owns the mutex AND performs the complete stale-lock exchange.
// Its death cannot release exclusion while another process is unlinking a lock.
function reapStaleLock({directory,lockPath,prior,bytes,helperFaultPoint}){
  const canonicalDirectory=fs.realpathSync.native(directory);
  const name=createHash('sha256').update(process.platform==='win32'?canonicalDirectory.toLowerCase():canonicalDirectory).digest('hex');
  let result;
  if(process.platform==='win32'){
    const quote=value=>`'${value.replace(/'/g,"''")}'`;
    const decode=value=>`[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(${quote(Buffer.from(value).toString('base64'))}))`;
    const script=`$m=$null; $owned=$false; try { `+
      `$m=[System.Threading.Mutex]::new($false,'Global\\WILL_EVIDENCE_${name}'); `+
      `try { $owned=$m.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned=$true }; `+
      `if (-not $owned) { exit 73 }; `+
      `$p=${quote(lockPath)}; $old=${decode(prior)}; $fresh=${decode(bytes)}; `+
      `if (-not [IO.File]::Exists($p) -or [IO.File]::ReadAllText($p) -cne $old) { exit 74 }; `+
      `$owner=ConvertFrom-Json $old; `+
      `if ($owner.schemaVersion -cne '${VERSION}' -or $owner.pid -lt 1 -or `+
      `$owner.nonce -notmatch '^[a-fA-F0-9-]{36}$') { exit 74 }; `+
      `try { $process=[Diagnostics.Process]::GetProcessById([int]$owner.pid); exit 74 } `+
      `catch [System.ArgumentException] {} catch { exit 74 }; `+
      `[IO.File]::Delete($p); `+
      (helperFaultPoint==='AFTER_STALE_LOCK_REMOVAL'?'exit 75; ':'')+
      `$stream=[IO.File]::Open($p,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None); `+
      `try { $buffer=[Text.Encoding]::UTF8.GetBytes($fresh); $stream.Write($buffer,0,$buffer.Length); $stream.Flush($true) } `+
      `finally { $stream.Dispose() }; Write-Output OK `+
      `} catch { exit 74 } finally { if ($owned) { $m.ReleaseMutex() }; if ($m) { $m.Dispose() } }`;
    result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],
      {encoding:'utf8',timeout:15000,windowsHide:true,maxBuffer:1024});
  }else if(process.platform==='linux'){
    const helper=`import fs from 'node:fs';import {inspectProcessInstance} from ${JSON.stringify(import.meta.url)};
      const p=${JSON.stringify(lockPath)},old=${JSON.stringify(prior)},fresh=${JSON.stringify(bytes)};
      try{if(fs.readFileSync(p,'utf8')!==old)process.exit(74);
        const owner=JSON.parse(old);if(owner.schemaVersion!==${JSON.stringify(VERSION)}||
          !Number.isSafeInteger(owner.pid)||owner.pid<1||!/^[a-f0-9-]{36}$/i.test(owner.nonce)||
          inspectProcessInstance(owner.pid).state!=='DEAD')process.exit(74);
        fs.unlinkSync(p);${helperFaultPoint==='AFTER_STALE_LOCK_REMOVAL'?'process.exit(75);':''}
        const fd=fs.openSync(p,'wx');try{fs.writeFileSync(fd,fresh);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
        process.stdout.write('OK');}catch{process.exit(74)}`;
    result=spawnSync('flock',['-n',path.join(canonicalDirectory,'writer.lock.reaper-mutex'),
      process.execPath,'--input-type=module','--eval',helper],{encoding:'utf8',timeout:15000,maxBuffer:1024});
  }else fail();
  if(result.error||result.status!==0||result.stdout.trim()!=='OK')fail();
}

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

export function withEvidenceLock({directory,inspectProcess=inspectProcessInstance,reaperFault=()=>{},helperFaultPoint=null},fn){
  const lockPath=path.join(directory,'writer.lock');
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
    reaperFault('BEFORE_STALE_LOCK_REMOVAL');
    let observed,prior;
    try{prior=fs.readFileSync(lockPath,'utf8');observed=JSON.parse(prior);}catch{fail();}
    if(observed?.schemaVersion!==VERSION||!Number.isSafeInteger(observed.pid)||observed.pid<1||
      typeof observed.birthId!=='string'||!observed.birthId||typeof observed.nonce!=='string'||
      !/^[a-f0-9-]{36}$/i.test(observed.nonce))fail();
    if(inspectProcess(observed.pid)?.state!=='DEAD')fail();
    reapStaleLock({directory,lockPath,prior,bytes,helperFaultPoint});
    reaperFault('AFTER_STALE_LOCK_REMOVAL');
  }
  try{return fn();}
  finally{
    if(fd!==undefined)fs.closeSync(fd);
    // Never unlink another owner's replacement lock.
    if(fs.readFileSync(lockPath,'utf8')!==bytes)fail();
    fs.unlinkSync(lockPath);
  }
}
