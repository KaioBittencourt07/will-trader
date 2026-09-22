import { canonical, sameMembership, validateManifest } from '../../learning/src/cycleEvidenceManifest.js';
import { classifyOos2sRecord } from './oos2sEvidence.js';
import { OOS2U_PROTOCOL } from './oos2uProtocol.js';

const creationProjection=record=>({id:record?.id??null,protocolId:record?.protocolId??null,campaignId:record?.campaignId??null,cycleId:record?.cycleId??null,writerGeneration:record?.writerGeneration??null,monitorCycleId:record?.metadata?.context?.monitorCycleId??null,asset:record?.asset??null,timeframe:record?.timeframe??null,direction:record?.direction??null,regime:record?.regime??null,setup:record?.setup??null,featureSnapshot:record?.metadata?.featureSnapshot??null});

export function verifyOos2uCycle(entry,history=[]) {
  const reasons=[],m=entry?.manifest,terminal=entry?.observationTerminal;
  try{validateManifest(m);}catch{return {valid:false,complete:false,reasons:['MANIFEST_INVALID'],records:[],classes:[],observationOutcome:null};}
  if(!entry.projectionValid)reasons.push('PROJECTION_INVALID');
  if(m.protocolId!==OOS2U_PROTOCOL)reasons.push('PROTOCOL_INVALID');
  if(m.state==='INVALID')reasons.push('MANIFEST_INVALID_STATE');else if(m.state!=='SEALED')reasons.push('NOT_SEALED');
  if(!terminal||!['SUCCESS','OPERATIONAL_FAILURE'].includes(terminal.outcome))reasons.push('OBSERVATION_TERMINAL_INVALID');
  if(terminal?.outcome==='SUCCESS'&&terminal.reasonCode!=null)reasons.push('OBSERVATION_TERMINAL_INVALID');
  if(terminal?.outcome==='OPERATIONAL_FAILURE'&&!/^[A-Z][A-Z0-9_]{0,63}$/.test(terminal.reasonCode??''))reasons.push('OBSERVATION_TERMINAL_INVALID');
  const rows=history.filter(r=>r?.cycleId===m.cycleId||r?.metadata?.context?.monitorCycleId===m.cycleId),ids=rows.map(r=>r?.id),inventory=new Set(m.recordIds);
  if(new Set(ids).size!==ids.length)reasons.push('DUPLICATE_RECORD');
  if(m.recordIds.some(id=>!ids.includes(id)))reasons.push('MISSING_RECORD');
  if(ids.some(id=>!inventory.has(id)))reasons.push('EXTRA_RECORD');
  if(rows.some(r=>!sameMembership(r,m)||r.metadata?.context?.monitorCycleId!==m.cycleId))reasons.push('MEMBERSHIP_MISMATCH');
  const creations=entry.creations??[],classes=rows.map(record=>classifyOos2sRecord(record,creations.find(x=>x.id===record.id),m));
  if(terminal?.outcome==='OPERATIONAL_FAILURE'&&rows.length)reasons.push('FAILURE_HAS_RECORDS');
  if(terminal?.outcome==='SUCCESS'&&classes.some(x=>!x.terminal))reasons.push('NON_TERMINAL_RECORD');
  if(terminal?.outcome==='SUCCESS'&&rows.some(record=>canonical(creationProjection(record))!==canonical(creationProjection(creations.find(x=>x.id===record.id)))))reasons.push('CREATION_FIELDS_MUTATED');
  const integrity=new Set(['MANIFEST_INVALID','PROJECTION_INVALID','PROTOCOL_INVALID','MANIFEST_INVALID_STATE','OBSERVATION_TERMINAL_INVALID','DUPLICATE_RECORD','MISSING_RECORD','EXTRA_RECORD','MEMBERSHIP_MISMATCH','FAILURE_HAS_RECORDS','CREATION_FIELDS_MUTATED']);
  return {valid:!reasons.some(x=>integrity.has(x)),complete:reasons.length===0,reasons:[...new Set(reasons)],records:rows,classes,observationOutcome:terminal?.outcome??null,observationFailureReason:terminal?.outcome==='OPERATIONAL_FAILURE'?terminal.reasonCode:null,tradeTerminalRecords:classes.filter(x=>x.class==='TRADE_TERMINAL').length,noTradeRecords:classes.filter(x=>x.class==='NO_TRADE_TERMINAL').length,dataInvalidRecords:classes.filter(x=>x.class==='DATA_INVALID_TERMINAL').length};
}
