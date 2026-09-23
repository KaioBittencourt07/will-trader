import fs from 'node:fs';
import path from 'node:path';
import {createCycleEvidenceRuntime} from '../../learning/src/cycleEvidenceRuntime.js';
import {replayEvidence} from './oos2rEvidence.js';
import {OOS2V_PROTOCOL,OOS2V_START_AUTHORIZATION,OOS2V_RESTART_AUTHORIZATION} from './oos2vProtocol.js';
import {readOos2vFreeze,auditOos2vBaselineBytes,auditOos2vBaselinePrefix} from './oos2vFreeze.js';

const fail=code=>{throw new Error(code);};
function absolute(value){if(typeof value!=='string'||!path.isAbsolute(value))fail('OOS2V_ABSOLUTE_PATH_REQUIRED');return path.resolve(value);}
function common({historyFile,evidenceDirectory,scanRoots,freezeFile,freezeHashFile,readFreeze=readOos2vFreeze}){
  const freeze=readFreeze(freezeFile,freezeHashFile),historyPath=absolute(historyFile),evidencePath=absolute(evidenceDirectory);
  if(!fs.existsSync(historyPath)||fs.lstatSync(historyPath).isSymbolicLink())fail('OOS2V_HISTORY_INVALID');
  const relative=path.relative(path.dirname(historyPath),evidencePath);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))fail('OOS2V_EVIDENCE_MUST_BE_HISTORY_CHILD');
  if(!Array.isArray(scanRoots)||!scanRoots.length||!scanRoots.every(path.isAbsolute)||
    !scanRoots.some(root=>{const rel=path.relative(root,path.dirname(historyPath));return rel===''||!rel.startsWith('..')&&!path.isAbsolute(rel);})||
    scanRoots.some(root=>!fs.existsSync(root)||fs.lstatSync(root).isSymbolicLink()))fail('OOS2V_SCAN_ROOTS_REQUIRED');
  const bytes=fs.readFileSync(historyPath),history=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
  return {freeze,historyPath,evidencePath,scanRoots,bytes,history};
}
function scan(root,freeze){
  for(const item of fs.readdirSync(root,{withFileTypes:true})){
    if(item.isSymbolicLink())fail('OOS2V_SCAN_SYMLINK');
    const target=path.join(root,item.name);
    if(item.isDirectory())scan(target,freeze);
    else if(item.name==='journal.jsonl'||item.name.endsWith('.manifest.json')){
      const text=fs.readFileSync(target,'utf8');
      if(text.includes(freeze.protocolId)||text.includes(freeze.campaignId))fail('OOS2V_EXISTING_EVIDENCE');
    }
  }
}
export function inspectOos2vActivation(options={}){
  const value=common(options);
  if(fs.existsSync(value.evidencePath))fail('OOS2V_EVIDENCE_DIRECTORY_ALREADY_EXISTS');
  auditOos2vBaselineBytes(value.bytes,value.freeze);
  if(value.history.some(r=>r?.protocolId===value.freeze.protocolId||r?.campaignId===value.freeze.campaignId))fail('OOS2V_EXISTING_MEMBERSHIP');
  value.scanRoots.forEach(root=>scan(root,value.freeze));
  const at=(options.now??(()=>Date.now()))();
  if(!Number.isFinite(at)||at<=Date.parse(value.freeze.edgeCut))fail('OOS2V_NOT_AFTER_EDGE_CUT');
  return Object.freeze({ready:true,mode:'FIRST_START',protocolId:value.freeze.protocolId,campaignId:value.freeze.campaignId,
    freezeIntegrity:'PASS',baselineContinuity:'PASS',evidenceDirectory:value.evidencePath,existingCycles:0,
    started:false,automatedBrokerExecution:false});
}
export function inspectOos2vRestart(options={}){
  const value=common(options);
  if(!fs.existsSync(value.evidencePath)||fs.lstatSync(value.evidencePath).isSymbolicLink())fail('OOS2V_RESTART_EVIDENCE_INVALID');
  auditOos2vBaselinePrefix(value.history,value.freeze);
  const wal=fs.readFileSync(path.join(value.evidencePath,'journal.jsonl'));
  const manifests=fs.readdirSync(value.evidencePath).filter(name=>name.endsWith('.manifest.json'))
    .map(name=>JSON.parse(fs.readFileSync(path.join(value.evidencePath,name),'utf8')));
  const entries=replayEvidence(wal,manifests);
  if(entries.length>50||entries.some(e=>!e.projectionValid||e.manifest.protocolId!==value.freeze.protocolId||
    e.manifest.campaignId!==value.freeze.campaignId||e.manifest.state==='INVALID'||
    Date.parse(e.manifest.openedAt)<=Date.parse(value.freeze.edgeCut)))fail('OOS2V_RESTART_EVIDENCE_INVALID');
  const generations=entries.map(e=>e.manifest.writerGeneration).sort((a,b)=>a-b);
  if(generations.some((n,i)=>n!==i+1))fail('OOS2V_RESTART_GENERATION_INVALID');
  return Object.freeze({ready:true,mode:'RESTART',recoverable:true,cycles:entries.length,
    collectionClosed:entries.length===50,evidenceDirectory:value.evidencePath,automatedBrokerExecution:false});
}
export function prepareOos2vEnvironment(env=process.env,{readFreeze=readOos2vFreeze,now=()=>Date.now()}={}){
  const first=env.WILL_OOS2V_START_AUTHORIZATION!==undefined,restart=env.WILL_OOS2V_RESTART_AUTHORIZATION!==undefined;
  const requested=first||restart||env.WILL_OOS2V_FREEZE_FILE!==undefined||env.WILL_OOS2V_FREEZE_HASH_FILE!==undefined||
    env.WILL_OOS2V_EVIDENCE_SCAN_ROOTS!==undefined||env.WILL_CYCLE_EVIDENCE_PROTOCOL_ID===OOS2V_PROTOCOL;
  if(!requested)return null;
  if(first===restart||env.WILL_CYCLE_EVIDENCE_ENABLED!=='true'||env.WILL_CYCLE_EVIDENCE_PROTOCOL_ID!==OOS2V_PROTOCOL||
    first&&env.WILL_OOS2V_START_AUTHORIZATION!==OOS2V_START_AUTHORIZATION||
    restart&&env.WILL_OOS2V_RESTART_AUTHORIZATION!==OOS2V_RESTART_AUTHORIZATION)fail('OOS2V_EXACT_ACTIVATION_CONFIGURATION_REQUIRED');
  const freeze=readFreeze(env.WILL_OOS2V_FREEZE_FILE,env.WILL_OOS2V_FREEZE_HASH_FILE);
  if(env.WILL_CYCLE_EVIDENCE_CAMPAIGN_ID!==freeze.campaignId)fail('OOS2V_EXACT_ACTIVATION_CONFIGURATION_REQUIRED');
  const options={historyFile:env.WILL_HISTORY_FILE,evidenceDirectory:env.WILL_CYCLE_EVIDENCE_DIRECTORY,
    scanRoots:JSON.parse(env.WILL_OOS2V_EVIDENCE_SCAN_ROOTS??'null'),freezeFile:env.WILL_OOS2V_FREEZE_FILE,
    freezeHashFile:env.WILL_OOS2V_FREEZE_HASH_FILE,readFreeze:()=>freeze};
  const report=first?inspectOos2vActivation({...options,now}):inspectOos2vRestart(options);
  return Object.freeze({mode:first?'FIRST_START':'RESTART',options,freeze,report});
}
function runtime(prepared,historyStore,now){
  return createCycleEvidenceRuntime({directory:prepared.report.evidenceDirectory,protocolId:prepared.freeze.protocolId,
    campaignId:prepared.freeze.campaignId,historyStore,observationTerminalRequired:true,maxCandidateCycles:50,
    recoverInterruptedOpenCycles:true,now:()=>{
      const at=now();if(!Number.isFinite(at)||at<=Date.parse(prepared.freeze.edgeCut))fail('OOS2V_NOT_AFTER_EDGE_CUT');
      return new Date(at).toISOString();
    }});
}
function guardEveryOpen(value,prepared,historyStore,{firstStart=false}={}){
  let first=firstStart;const open=value.openMonitorCycle.bind(value);
  value.openMonitorCycle=id=>{
    try{
      const bytes=fs.readFileSync(prepared.options.historyFile),disk=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
      auditOos2vBaselinePrefix(historyStore.list(),prepared.freeze);
      auditOos2vBaselinePrefix(disk,prepared.freeze);
      if(first)auditOos2vBaselineBytes(bytes,prepared.freeze);
    }catch{value.pause();fail('OOS2V_BASELINE_CHANGED_BEFORE_OPEN');}
    const manifest=open(id);first=false;return manifest;
  };
  return value;
}
export function createPreparedOos2vRuntime({prepared,historyStore,now=()=>Date.now()}={}){
  if(prepared?.mode!=='FIRST_START')fail('OOS2V_FIRST_START_REQUIRED');
  inspectOos2vActivation({...prepared.options,now});
  fs.mkdirSync(prepared.report.evidenceDirectory);
  return guardEveryOpen(runtime(prepared,historyStore,now),prepared,historyStore,{firstStart:true});
}
export function createRecoveredOos2vRuntime({prepared,historyStore,now=()=>Date.now()}={}){
  if(prepared?.mode!=='RESTART')fail('OOS2V_RESTART_REQUIRED');
  inspectOos2vRestart(prepared.options);
  return guardEveryOpen(runtime(prepared,historyStore,now),prepared,historyStore);
}
