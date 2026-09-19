import fs from 'node:fs';
import path from 'node:path';
import { readOos2rFreeze, EXPECTED_OOS2R_FREEZE_SHA256 } from './evaluateOos2r.js';
import { baselineCommitment } from './oos2rEvidence.js';
import { createCycleEvidenceRuntime } from '../../learning/src/cycleEvidenceRuntime.js';

export const OOS2R_PROTOCOL='will-edge-gate-oos2r-v1';
export const OOS2R_CAMPAIGN='will-edge-gate-oos2r-20260918-v1';
export const OOS2R_START_AUTHORIZATION='START_APPROVED_OOS2R_FIRST_COLLECTION_V1';
const fail=code=>{throw new Error(code);};
export function assertPristineOos2rHistory(history,freeze) {
  const commitment=baselineCommitment(history);
  // Strict first-start policy: extra records also require a new operator review.
  if(commitment.baselineCount!==freeze.baselineCount||commitment.baselineIdsSha256!==freeze.baselineIdsSha256)fail('OOS2R_BASELINE_CONTINUITY_FAILED');
  if(history.some(r=>r.protocolId===OOS2R_PROTOCOL||r.campaignId===OOS2R_CAMPAIGN))fail('OOS2R_EXISTING_MEMBERSHIP');
  return commitment;
}
function scanEvidence(root) {
  if(!fs.existsSync(root))fail('OOS2R_SCAN_ROOT_MISSING');
  const walk=directory=>{
    if(fs.lstatSync(directory).isSymbolicLink())fail('OOS2R_SCAN_SYMLINK');
    for(const item of fs.readdirSync(directory,{withFileTypes:true})) {
      if(item.isSymbolicLink())fail('OOS2R_SCAN_SYMLINK');
      const file=path.join(directory,item.name);
      if(item.isDirectory()){walk(file);continue;}
      if(!item.name.endsWith('.manifest.json')&&item.name!=='journal.jsonl')continue;
      let values;
      try {
        const raw=fs.readFileSync(file,'utf8');
        values=item.name==='journal.jsonl'?raw.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line).payload):[JSON.parse(raw)];
      }catch{fail('OOS2R_EXISTING_EVIDENCE_UNREADABLE');}
      if(!values.length||typeof values[0]?.protocolId!=='string'||typeof values[0]?.campaignId!=='string')fail('OOS2R_EXISTING_EVIDENCE_UNREADABLE');
      if(values.some(p=>p?.protocolId===OOS2R_PROTOCOL||p?.campaignId===OOS2R_CAMPAIGN))fail('OOS2R_EXISTING_EVIDENCE');
    }
  };
  walk(root);
}

// Read-only preflight. No dotenv, secrets, network, runtime start or directory creation.
export function inspectOos2rActivation({historyFile,evidenceDirectory,scanRoots,freezeFile,now=()=>Date.now(),readFreeze=readOos2rFreeze}={}) {
  const freeze=readFreeze(freezeFile);
  if(freeze.protocolId!==OOS2R_PROTOCOL||freeze.campaignId!==OOS2R_CAMPAIGN)fail('OOS2R_FROZEN_IDENTITY_INVALID');
  if(!path.isAbsolute(historyFile??'')||!path.isAbsolute(evidenceDirectory??''))fail('OOS2R_ABSOLUTE_PATH_REQUIRED');
  const historyDirectory=path.dirname(historyFile),relative=path.relative(historyDirectory,evidenceDirectory);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))fail('OOS2R_EVIDENCE_MUST_BE_NEW_HISTORY_CHILD');
  if(!Array.isArray(scanRoots)||!scanRoots.length||scanRoots.some(p=>!path.isAbsolute(p)))fail('OOS2R_SCAN_ROOTS_REQUIRED');
  if(!scanRoots.some(root=>{const r=path.relative(root,historyDirectory);return r===''||(!r.startsWith('..')&&!path.isAbsolute(r));}))fail('OOS2R_HISTORY_ROOT_NOT_SCANNED');
  const history=JSON.parse(fs.readFileSync(historyFile,'utf8').replace(/^\uFEFF/,''));
  const commitment=assertPristineOos2rHistory(history,freeze);
  if(fs.existsSync(evidenceDirectory))fail('OOS2R_EVIDENCE_DIRECTORY_ALREADY_EXISTS');
  for(const root of scanRoots)scanEvidence(root);
  const at=now();if(!Number.isFinite(at)||at<=Date.parse(freeze.edgeCut))fail('OOS2R_NOT_AFTER_EDGE_CUT');
  return Object.freeze({ready:true,protocolId:freeze.protocolId,campaignId:freeze.campaignId,edgeCut:freeze.edgeCut,
    freezeIntegrity:'PASS',freezeSha256:EXPECTED_OOS2R_FREEZE_SHA256,baselineContinuity:'PASS',...commitment,
    existingOos2rCycles:0,evidenceDirectory:path.resolve(evidenceDirectory),scanScope:[...scanRoots],
    evidenceDirectoryState:'ABSENT_RESERVED_FOR_EXCLUSIVE_FIRST_START',started:false});
}

// Called before secret hydration/history backup/provider creation in server.js.
export function prepareOos2rEnvironment(env=process.env) {
  const reservedEvidenceDirectory=
    typeof env.WILL_CYCLE_EVIDENCE_DIRECTORY==='string'&&
    path.basename(path.normalize(env.WILL_CYCLE_EVIDENCE_DIRECTORY)).toLowerCase()==='oos2r-evidence-20260918-v1';

  const requested=
    env.WILL_OOS2R_START_AUTHORIZATION!==undefined||
    env.WILL_OOS2R_EVIDENCE_SCAN_ROOTS!==undefined||
    env.WILL_CYCLE_EVIDENCE_PROTOCOL_ID===OOS2R_PROTOCOL||
    env.WILL_CYCLE_EVIDENCE_CAMPAIGN_ID===OOS2R_CAMPAIGN||
    reservedEvidenceDirectory;
  if(!requested)return null;
  if(env.WILL_OOS2R_START_AUTHORIZATION!==OOS2R_START_AUTHORIZATION||env.WILL_CYCLE_EVIDENCE_ENABLED!=='true'||
    env.WILL_CYCLE_EVIDENCE_PROTOCOL_ID!==OOS2R_PROTOCOL||env.WILL_CYCLE_EVIDENCE_CAMPAIGN_ID!==OOS2R_CAMPAIGN)fail('OOS2R_EXACT_ACTIVATION_CONFIGURATION_REQUIRED');
  const roots=JSON.parse(env.WILL_OOS2R_EVIDENCE_SCAN_ROOTS??'null');
  const options={historyFile:env.WILL_HISTORY_FILE,evidenceDirectory:env.WILL_CYCLE_EVIDENCE_DIRECTORY,scanRoots:roots};
  return {options,report:inspectOos2rActivation(options)};
}

// Future startup ONLY. First-start reservation is exclusive and cannot reuse even an empty directory.
export function createPreparedOos2rRuntime({prepared,historyStore,now=()=>Date.now(),readFreeze=readOos2rFreeze}={}) {
  const fresh=inspectOos2rActivation({...prepared.options,now,readFreeze});
  const freeze=readFreeze();assertPristineOos2rHistory(historyStore.list(),freeze);
  fs.mkdirSync(fresh.evidenceDirectory); // EEXIST blocks competing starts; no recursive reuse.
  let first=true;
  const runtime=createCycleEvidenceRuntime({directory:fresh.evidenceDirectory,protocolId:OOS2R_PROTOCOL,campaignId:OOS2R_CAMPAIGN,historyStore,
    now:()=>{const at=now();if(!Number.isFinite(at)||at<=Date.parse(freeze.edgeCut))fail('OOS2R_NOT_AFTER_EDGE_CUT');return new Date(at).toISOString();}});
  const open=runtime.openMonitorCycle.bind(runtime);
  runtime.openMonitorCycle=cycleId=>{
    if(first){try{assertPristineOos2rHistory(historyStore.list(),freeze);}catch{runtime.pause();fail('OOS2R_BASELINE_CHANGED_BEFORE_FIRST_OPEN');}}
    const manifest=open(cycleId);first=false;return manifest;
  };
  return runtime;
}
