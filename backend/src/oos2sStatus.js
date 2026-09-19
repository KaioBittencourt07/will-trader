import fs from 'node:fs';import path from 'node:path';
import { replayEvidence } from './oos2rEvidence.js';import { readOos2sFreeze } from './oos2sFreeze.js';import { verifyOos2sCycle } from './oos2sEvidence.js';
import { validateManifest } from '../../learning/src/cycleEvidenceManifest.js';
const failed=error=>Object.freeze({schemaVersion:'will-oos2s-status-v1',ok:false,state:'OOS2S_FAIL_CLOSED',error,formalAnalysisAllowed:false});
export function inspectOos2sStatus({evidenceDirectory,history=[],freezeFile,freezeHashFile,readFreeze=readOos2sFreeze}={}) {
  let freeze;try{freeze=readFreeze(freezeFile,freezeHashFile);}catch{return failed('OOS2S_FREEZE_INVALID');}
  if(!path.isAbsolute(evidenceDirectory??''))return failed('OOS2S_EVIDENCE_INVALID');
  if(!fs.existsSync(evidenceDirectory))return Object.freeze({schemaVersion:'will-oos2s-status-v1',ok:true,state:'OOS2S_NOT_STARTED',first50:{observed:0,sealed:0,invalid:0,open:0,complete:0,incomplete:0,noTradeRecords:0},formalAnalysisAllowed:false});
  try {
    if(fs.lstatSync(evidenceDirectory).isSymbolicLink())return failed('OOS2S_EVIDENCE_INVALID');
    const journal=path.join(evidenceDirectory,'journal.jsonl');if(!fs.existsSync(journal))return failed('OOS2S_EVIDENCE_INVALID');
    const manifests=fs.readdirSync(evidenceDirectory,{withFileTypes:true}).filter(x=>x.isFile()&&x.name.endsWith('.manifest.json')).map(x=>JSON.parse(fs.readFileSync(path.join(evidenceDirectory,x.name),'utf8')));
    try{manifests.forEach(validateManifest);}catch{return failed('OOS2S_PROJECTION_INVALID');}
    const entries=replayEvidence(fs.readFileSync(journal),manifests);
    if(entries.some(e=>!e.projectionValid))return failed('OOS2S_PROJECTION_INVALID');
    if(entries.some(e=>e.manifest.protocolId!==freeze.protocolId||e.manifest.campaignId!==freeze.campaignId))return failed('OOS2S_IDENTITY_MISMATCH');
    if(history.some(r=>(r.protocolId===freeze.protocolId||r.campaignId===freeze.campaignId)&&!entries.some(e=>e.manifest.recordIds.includes(r.id))))return failed('OOS2S_IDENTITY_MISMATCH');
    if(entries.some(e=>Date.parse(e.manifest.openedAt)<=Date.parse(freeze.edgeCut)))return failed('OOS2S_TEMPORAL_MEMBERSHIP_INVALID');
    const first=entries.sort((a,b)=>Date.parse(a.manifest.openedAt)-Date.parse(b.manifest.openedAt)||a.manifest.cycleId.localeCompare(b.manifest.cycleId)).slice(0,50),checked=first.map(e=>verifyOos2sCycle(e,history));
    return Object.freeze({schemaVersion:'will-oos2s-status-v1',ok:true,state:'OOS2S_COLLECTION_STATUS',protocolId:freeze.protocolId,campaignId:freeze.campaignId,first50:{observed:first.length,sealed:first.filter(e=>e.manifest.state==='SEALED').length,invalid:first.filter(e=>e.manifest.state==='INVALID').length,open:first.filter(e=>e.manifest.state==='OPEN').length,complete:checked.filter(x=>x.complete).length,incomplete:checked.filter(x=>!x.complete).length,noTradeRecords:checked.reduce((n,x)=>n+x.noTradeRecords,0)},formalAnalysisAllowed:false});
  }catch{return failed('OOS2S_EVIDENCE_INVALID');}
}
