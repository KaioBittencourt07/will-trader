import {canonical,sameMembership,validateManifest} from '../../learning/src/cycleEvidenceManifest.js';
import {classifyOos2sRecord} from './oos2sEvidence.js';
import {verifyRecoveryInterruptedCycle} from './oos2rEvidence.js';
import {OOS2V_PROTOCOL} from './oos2vProtocol.js';

const projection=r=>({id:r?.id??null,protocolId:r?.protocolId??null,campaignId:r?.campaignId??null,
  cycleId:r?.cycleId??null,writerGeneration:r?.writerGeneration??null,
  monitorCycleId:r?.metadata?.context?.monitorCycleId??null,asset:r?.asset??null,timeframe:r?.timeframe??null,
  direction:r?.direction??null,regime:r?.regime??null,setup:r?.setup??null,
  featureSnapshot:r?.metadata?.featureSnapshot??null});
export function verifyOos2vCycle(entry,history=[]){
  const reasons=[],m=entry?.manifest,terminal=entry?.observationTerminal;
  try{validateManifest(m);}catch{return {valid:false,complete:false,performanceEligible:false,replacementAllowed:false,
    reasons:['MANIFEST_INVALID'],records:[],observationOutcome:null};}
  if(m.protocolId!==OOS2V_PROTOCOL)reasons.push('PROTOCOL_INVALID');
  if(entry.projectionValid!==true)reasons.push('PROJECTION_INVALID');
  if(m.state!=='SEALED')reasons.push('NOT_SEALED');
  const rows=Array.isArray(history)?history.filter(r=>r?.cycleId===m.cycleId||r?.metadata?.context?.monitorCycleId===m.cycleId):[];
  if(!Array.isArray(history))reasons.push('HISTORY_INVALID');
  const inventory=new Set(m.recordIds),ids=rows.map(r=>r?.id);
  if(new Set(ids).size!==ids.length)reasons.push('DUPLICATE_RECORD');
  if(m.recordIds.some(id=>!ids.includes(id)))reasons.push('MISSING_RECORD');
  if(ids.some(id=>!inventory.has(id)))reasons.push('EXTRA_RECORD');
  if(rows.some(r=>!sameMembership(r,m)||r.metadata?.context?.monitorCycleId!==m.cycleId))reasons.push('MEMBERSHIP_MISMATCH');
  const creations=entry.creations??[];
  if(creations.length!==rows.length||rows.some(r=>{
    const created=creations.find(c=>c.id===r.id);
    return !created||canonical(projection(r))!==canonical(projection(created));
  }))reasons.push('CREATION_FIELDS_MUTATED');
  if(terminal?.outcome==='RECOVERY_INTERRUPTED'){
    if(!verifyRecoveryInterruptedCycle(entry,history).valid||terminal.reasonCode!=='PROCESS_INTERRUPTION')reasons.push('RECOVERY_TERMINAL_INVALID');
    const valid=reasons.length===0;
    return {valid,complete:valid,performanceEligible:false,replacementAllowed:false,slotConsumed:valid,
      reasons,records:rows,observationOutcome:'RECOVERY_INTERRUPTED'};
  }
  if(!terminal||!['SUCCESS','OPERATIONAL_FAILURE'].includes(terminal.outcome)||
    terminal.outcome==='SUCCESS'&&terminal.reasonCode!=null||
    terminal.outcome==='OPERATIONAL_FAILURE'&&!/^[A-Z][A-Z0-9_]{0,63}$/.test(terminal.reasonCode??''))reasons.push('OBSERVATION_TERMINAL_INVALID');
  if(terminal?.outcome==='OPERATIONAL_FAILURE'&&rows.length)reasons.push('FAILURE_HAS_RECORDS');
  const classes=rows.map(r=>classifyOos2sRecord(r,creations.find(c=>c.id===r.id),m));
  if(terminal?.outcome==='SUCCESS'&&classes.some(c=>!c.terminal))reasons.push('NON_TERMINAL_RECORD');
  const integrity=new Set(['PROTOCOL_INVALID','PROJECTION_INVALID','HISTORY_INVALID','DUPLICATE_RECORD','MISSING_RECORD',
    'EXTRA_RECORD','MEMBERSHIP_MISMATCH','CREATION_FIELDS_MUTATED','OBSERVATION_TERMINAL_INVALID','FAILURE_HAS_RECORDS']);
  const valid=!reasons.some(reason=>integrity.has(reason));
  return {valid,complete:reasons.length===0,performanceEligible:terminal?.outcome==='SUCCESS'&&reasons.length===0,
    replacementAllowed:false,slotConsumed:true,reasons,records:rows,observationOutcome:terminal?.outcome??null};
}
