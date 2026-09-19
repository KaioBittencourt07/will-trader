import { canonical, sameMembership, validTime, validateManifest } from '../../learning/src/cycleEvidenceManifest.js';

export const OOS2S_PROTOCOL='will-edge-gate-oos2s-v1';
export const OOS2S_CAMPAIGN='will-edge-gate-oos2s-20260919-v1';
const OFFICIAL_OUTCOMES=new Set(['WIN','LOSS','TIE']);

export function classifyOos2sRecord(record, initial, manifest) {
  if (!record || !initial || !manifest || !sameMembership(record,manifest) || !sameMembership(initial,manifest) || record.id!==initial.id) return {terminal:false,class:'INVALID',reason:'MEMBERSHIP_MISMATCH'};
  if (record.status==='SKIPPED') {
    const noTrade=value=>value.status==='SKIPPED'&&value.execution==null&&value.outcome==null&&value.settledAt==null&&value.clickTime==null;
    if (!noTrade(initial) || !noTrade(record) || canonical(initial)!==canonical(record)) return {terminal:false,class:'INVALID',reason:'NO_TRADE_MUTATED'};
    return {terminal:true,class:'NO_TRADE_TERMINAL'};
  }
  if (record.status!=='CLOSED'||!['WIN','LOSS','TIE','DATA_INVALID'].includes(record.outcome)||!validTime(record.settledAt)||Date.parse(record.settledAt)<Date.parse(manifest.openedAt)) {
    return {terminal:false,class:'PENDING',reason:'TRADE_NOT_TERMINAL'};
  }
  if (OFFICIAL_OUTCOMES.has(record.outcome) && (record.execution?.status!=='PAPER_CONFIRMED'||record.outcomeMetadata?.settlementVersion!=='paper-outcome-settlement-v2'||record.outcomeMetadata?.source!=='paper-live-temporal-reference-v1')) {
    return {terminal:false,class:'INVALID',reason:'TRADE_PROVENANCE_INVALID'};
  }
  return {terminal:true,class:record.outcome==='DATA_INVALID'?'DATA_INVALID_TERMINAL':'TRADE_TERMINAL'};
}

export function verifyOos2sCycle(entry,history) {
  const reasons=[];const m=entry?.manifest;
  try{validateManifest(m);}catch{return {valid:false,complete:false,reasons:['MANIFEST_INVALID'],records:[],classes:[]};}
  if(!entry.projectionValid)reasons.push('PROJECTION_INVALID');
  const rows=history.filter(r=>r?.cycleId===m.cycleId||r?.metadata?.context?.monitorCycleId===m.cycleId);
  const ids=rows.map(r=>r?.id),inventory=new Set(m.recordIds);
  if(new Set(ids).size!==ids.length)reasons.push('DUPLICATE_RECORD');
  if(m.recordIds.some(id=>!ids.includes(id)))reasons.push('MISSING_RECORD');
  if(ids.some(id=>!inventory.has(id)))reasons.push('EXTRA_RECORD');
  if(rows.some(r=>!sameMembership(r,m)))reasons.push('MEMBERSHIP_MISMATCH');
  if(m.state!=='SEALED')reasons.push('NOT_SEALED');
  const classes=rows.map(record=>classifyOos2sRecord(record,entry.creations.find(x=>x.id===record.id),m));
  if(classes.some(x=>!x.terminal))reasons.push('NON_TERMINAL_RECORD');
  const valid=!reasons.some(x=>['MANIFEST_INVALID','PROJECTION_INVALID','DUPLICATE_RECORD','MISSING_RECORD','EXTRA_RECORD','MEMBERSHIP_MISMATCH'].includes(x));
  return {valid,complete:reasons.length===0,reasons:[...new Set(reasons)],records:rows,classes,
    tradeTerminalRecords:classes.filter(x=>x.class==='TRADE_TERMINAL').length,
    noTradeRecords:classes.filter(x=>x.class==='NO_TRADE_TERMINAL').length,
    dataInvalidRecords:classes.filter(x=>x.class==='DATA_INVALID_TERMINAL').length};
}
