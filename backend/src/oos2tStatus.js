import fs from 'node:fs';import path from 'node:path';import { replayEvidence } from './oos2rEvidence.js';
import { verifyOos2tCycle,OOS2T_PROTOCOL } from './oos2tEvidence.js';
export function inspectOos2tStatus({history=[],walBytes=Buffer.alloc(0),manifests=[],campaignId=null,edgeCut=null}={}) {
  const failed=error=>({schemaVersion:'will-oos2t-status-v1',ok:false,state:'OOS2T_FAIL_CLOSED',error,formalAnalysisAllowed:false});
  if(typeof campaignId!=='string'||!campaignId||!Number.isFinite(Date.parse(edgeCut)))return failed('OOS2T_CONFIGURATION_UNAVAILABLE');
  try {
    const all=replayEvidence(walBytes,manifests);
    if(all.some(e=>e.manifest.protocolId!==OOS2T_PROTOCOL||e.manifest.campaignId!==campaignId))return failed('OOS2T_IDENTITY_MISMATCH');
    const cut=Date.parse(edgeCut);
    if(all.some(e=>!Number.isFinite(Date.parse(e.manifest.openedAt))||Date.parse(e.manifest.openedAt)<=cut))return failed('OOS2T_TEMPORAL_MEMBERSHIP_INVALID');
    const ordered=all.sort((a,b)=>Date.parse(a.manifest.openedAt)-Date.parse(b.manifest.openedAt)||a.manifest.cycleId.localeCompare(b.manifest.cycleId));
    const entries=ordered.slice(0,50),checked=entries.map(e=>verifyOos2tCycle(e,history)),reasons={};
    for(const c of checked.filter(c=>c.observationOutcome==='OPERATIONAL_FAILURE'))reasons[c.observationFailureReason]=(reasons[c.observationFailureReason]??0)+1;
    const complete=checked.filter(c=>c.complete).length,successes=checked.filter(c=>c.observationOutcome==='SUCCESS').length,failures=checked.filter(c=>c.observationOutcome==='OPERATIONAL_FAILURE').length,closed=ordered.length>=50;
    return {schemaVersion:'will-oos2t-status-v1',ok:true,state:'OOS2T_COLLECTION_STATUS',candidateCyclesObserved:ordered.length,candidateCycleLimit:50,collectionClosed:closed,newCandidateAdmissionAllowed:!closed,completedCandidateCycles:complete,incompleteCandidateCycles:entries.length-complete,successfulObservationCycles:successes,operationalFailureCycles:failures,first50:{observed:entries.length,sealed:entries.filter(e=>e.manifest.state==='SEALED').length,invalid:entries.filter(e=>e.manifest.state==='INVALID').length,open:entries.filter(e=>e.manifest.state==='OPEN').length,complete,incomplete:entries.length-complete,successfulObservationCycles:successes,observationFailureCycles:failures,observationFailureReasonCounts:Object.fromEntries(Object.entries(reasons).sort(([a],[b])=>a.localeCompare(b))),noTradeRecords:checked.reduce((n,c)=>n+c.noTradeRecords,0),dataInvalidRecords:checked.reduce((n,c)=>n+c.dataInvalidRecords,0)},formalAnalysisAllowed:entries.length===50&&complete===50};
  }catch{return failed('OOS2T_EVIDENCE_INVALID');}
}
export function inspectOos2tDirectoryStatus({evidenceDirectory,history=[],freeze}={}){
  if(!freeze||!path.isAbsolute(evidenceDirectory??''))return {schemaVersion:'will-oos2t-status-v1',ok:false,state:'OOS2T_FAIL_CLOSED',error:'OOS2T_CONFIGURATION_UNAVAILABLE',formalAnalysisAllowed:false};
  if(!fs.existsSync(evidenceDirectory))return {schemaVersion:'will-oos2t-status-v1',ok:true,state:'OOS2T_NOT_STARTED',first50:{observed:0,sealed:0,invalid:0,open:0,complete:0,incomplete:0,successfulObservationCycles:0,observationFailureCycles:0,observationFailureReasonCounts:{},noTradeRecords:0,dataInvalidRecords:0},formalAnalysisAllowed:false};
  try{if(fs.lstatSync(evidenceDirectory).isSymbolicLink())throw Error();const walBytes=fs.readFileSync(path.join(evidenceDirectory,'journal.jsonl')),manifests=fs.readdirSync(evidenceDirectory).filter(x=>x.endsWith('.manifest.json')).map(x=>JSON.parse(fs.readFileSync(path.join(evidenceDirectory,x),'utf8')));return inspectOos2tStatus({history,walBytes,manifests,campaignId:freeze.campaignId,edgeCut:freeze.edgeCut});}catch{return {schemaVersion:'will-oos2t-status-v1',ok:false,state:'OOS2T_FAIL_CLOSED',error:'OOS2T_EVIDENCE_INVALID',formalAnalysisAllowed:false};}
}
