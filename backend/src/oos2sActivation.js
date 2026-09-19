import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createCycleEvidenceRuntime } from '../../learning/src/cycleEvidenceRuntime.js';
import { baselineCommitment,replayEvidence } from './oos2rEvidence.js';
import { readOos2sFreeze } from './oos2sFreeze.js';
import { OOS2S_PROTOCOL,OOS2S_CAMPAIGN } from './oos2sEvidence.js';
import { verifyOos2sCycle } from './oos2sEvidence.js';

export const OOS2S_START_AUTHORIZATION='START_APPROVED_OOS2S_FIRST_COLLECTION_V1';
export const OOS2S_RESTART_AUTHORIZATION='RESTART_APPROVED_OOS2S_READONLY_PREFLIGHT_V1';
const fail=code=>{throw new Error(code);};
const fileHash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export function assertPristineOos2sHistory(history,historyFile,freeze) {
  const commitment=baselineCommitment(history);
  if(commitment.baselineCount!==freeze.baselineCount||commitment.baselineIdsSha256!==freeze.baselineIdsSha256||fileHash(historyFile)!==freeze.historyFileSha256)fail('OOS2S_BASELINE_CONTINUITY_FAILED');
  if(history.some(r=>r.protocolId===OOS2S_PROTOCOL||r.campaignId===OOS2S_CAMPAIGN))fail('OOS2S_EXISTING_MEMBERSHIP');
  return {...commitment,historyFileSha256:freeze.historyFileSha256};
}
function scan(root) {
  if(!path.isAbsolute(root)||!fs.existsSync(root))fail('OOS2S_SCAN_ROOT_INVALID');
  for(const item of fs.readdirSync(root,{withFileTypes:true})) {
    if(item.isSymbolicLink())fail('OOS2S_SCAN_INVALID');const p=path.join(root,item.name);
    if(item.isDirectory()){scan(p);continue;}if(!item.name.endsWith('.manifest.json')&&item.name!=='journal.jsonl')continue;
    let text;try{text=fs.readFileSync(p,'utf8');}catch{fail('OOS2S_SCAN_INVALID');}
    if(text.includes(OOS2S_PROTOCOL)||text.includes(OOS2S_CAMPAIGN))fail('OOS2S_EXISTING_EVIDENCE');
  }
}
export function inspectOos2sActivation({historyFile,evidenceDirectory,scanRoots,freezeFile,freezeHashFile,now=()=>Date.now(),readFreeze=readOos2sFreeze}={}) {
  const freeze=readFreeze(freezeFile,freezeHashFile);
  if(!path.isAbsolute(historyFile??'')||!path.isAbsolute(evidenceDirectory??''))fail('OOS2S_ABSOLUTE_PATH_REQUIRED');
  const historyDirectory=path.dirname(historyFile),relative=path.relative(historyDirectory,evidenceDirectory);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))fail('OOS2S_EVIDENCE_MUST_BE_NEW_HISTORY_CHILD');
  const history=JSON.parse(fs.readFileSync(historyFile,'utf8').replace(/^\uFEFF/,''));
  const commitment=assertPristineOos2sHistory(history,historyFile,freeze);
  if(fs.existsSync(evidenceDirectory))fail('OOS2S_EVIDENCE_DIRECTORY_ALREADY_EXISTS');
  if(!Array.isArray(scanRoots)||!scanRoots.length||!scanRoots.some(root=>{const r=path.relative(root,historyDirectory);return r===''||(!r.startsWith('..')&&!path.isAbsolute(r));}))fail('OOS2S_SCAN_ROOTS_REQUIRED');for(const root of scanRoots)scan(root);
  const at=now();if(!Number.isFinite(at)||at<=Date.parse(freeze.edgeCut))fail('OOS2S_NOT_AFTER_EDGE_CUT');
  return Object.freeze({ready:true,protocolId:OOS2S_PROTOCOL,campaignId:OOS2S_CAMPAIGN,edgeCut:freeze.edgeCut,freezeIntegrity:'PASS',baselineContinuity:'PASS',...commitment,existingOos2sCycles:0,started:false,evidenceDirectory:path.resolve(evidenceDirectory)});
}
export function prepareOos2sEnvironment(env=process.env) {
  const reserved=typeof env.WILL_CYCLE_EVIDENCE_DIRECTORY==='string'&&path.basename(path.normalize(env.WILL_CYCLE_EVIDENCE_DIRECTORY)).toLowerCase()==='oos2s-evidence-20260919-v1';
  const requested=env.WILL_OOS2S_START_AUTHORIZATION!==undefined||env.WILL_OOS2S_EVIDENCE_SCAN_ROOTS!==undefined||env.WILL_CYCLE_EVIDENCE_PROTOCOL_ID===OOS2S_PROTOCOL||env.WILL_CYCLE_EVIDENCE_CAMPAIGN_ID===OOS2S_CAMPAIGN||reserved;
  if(!requested)return null;
  if(env.WILL_OOS2S_START_AUTHORIZATION!==OOS2S_START_AUTHORIZATION||env.WILL_CYCLE_EVIDENCE_ENABLED!=='true'||env.WILL_CYCLE_EVIDENCE_PROTOCOL_ID!==OOS2S_PROTOCOL||env.WILL_CYCLE_EVIDENCE_CAMPAIGN_ID!==OOS2S_CAMPAIGN)fail('OOS2S_EXACT_ACTIVATION_CONFIGURATION_REQUIRED');
  const options={historyFile:env.WILL_HISTORY_FILE,evidenceDirectory:env.WILL_CYCLE_EVIDENCE_DIRECTORY,scanRoots:JSON.parse(env.WILL_OOS2S_EVIDENCE_SCAN_ROOTS??'null')};
  return {options,report:inspectOos2sActivation(options)};
}
export function inspectOos2sRestart({evidenceDirectory,history,freezeFile,freezeHashFile,readFreeze=readOos2sFreeze}={}) {
  const freeze=readFreeze(freezeFile,freezeHashFile);if(!path.isAbsolute(evidenceDirectory??'')||!fs.existsSync(evidenceDirectory))fail('OOS2S_RESTART_EVIDENCE_REQUIRED');
  if(!Array.isArray(history))fail('OOS2S_RESTART_HISTORY_REQUIRED');
  if(fs.existsSync(path.join(evidenceDirectory,'writer.lock')))fail('OOS2S_RESTART_LOCKED');
  const wal=fs.readFileSync(path.join(evidenceDirectory,'journal.jsonl'));const projections=fs.readdirSync(evidenceDirectory).filter(x=>x.endsWith('.manifest.json')).map(x=>JSON.parse(fs.readFileSync(path.join(evidenceDirectory,x),'utf8')));
  const entries=replayEvidence(wal,projections);if(entries.some(e=>!e.projectionValid||e.manifest.protocolId!==freeze.protocolId||e.manifest.campaignId!==freeze.campaignId))fail('OOS2S_RESTART_EVIDENCE_INVALID');
  const generations=entries.map(e=>e.manifest.writerGeneration).sort((a,b)=>a-b);if(generations.some((value,index)=>value!==index+1))fail('OOS2S_RESTART_GENERATION_INVALID');
  const checks=entries.map(e=>verifyOos2sCycle(e,history));const ambiguity=history.some(r=>(r.protocolId===freeze.protocolId||r.campaignId===freeze.campaignId)&&!entries.some(e=>e.manifest.recordIds.includes(r.id)));
  if(ambiguity||checks.some(x=>!x.valid))fail('OOS2S_RESTART_HISTORY_INCOMPATIBLE');
  return Object.freeze({recoverable:entries.every(e=>e.manifest.state==='SEALED')&&checks.every(x=>x.complete),writableRecoveryAuthorized:false,cycles:entries.length});
}
export function createPreparedOos2sRuntime({prepared,historyStore,now=()=>Date.now(),readFreeze=readOos2sFreeze}={}) {
  const fresh=inspectOos2sActivation({...prepared.options,now,readFreeze});const freeze=readFreeze();
  assertPristineOos2sHistory(historyStore.list(),prepared.options.historyFile,freeze);fs.mkdirSync(fresh.evidenceDirectory);
  let first=true;const runtime=createCycleEvidenceRuntime({directory:fresh.evidenceDirectory,protocolId:OOS2S_PROTOCOL,campaignId:OOS2S_CAMPAIGN,historyStore,now:()=>{const at=now();if(at<=Date.parse(freeze.edgeCut))fail('OOS2S_NOT_AFTER_EDGE_CUT');return new Date(at).toISOString();}});
  const open=runtime.openMonitorCycle.bind(runtime);runtime.openMonitorCycle=id=>{if(first){try{assertPristineOos2sHistory(historyStore.list(),prepared.options.historyFile,freeze);}catch{runtime.pause();fail('OOS2S_BASELINE_CHANGED_BEFORE_FIRST_OPEN');}}const m=open(id);first=false;return m;};return runtime;
}
