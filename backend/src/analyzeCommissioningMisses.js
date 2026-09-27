import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REFERENCE_DEADLINE_MS } from './finalCommissioning.js';

const REASONS=new Map([
  ['PAPER_ENTRY_REFERENCE_WINDOW_MISSED','ENTRY'],
  ['PAPER_EXIT_REFERENCE_WINDOW_MISSED','EXIT']
]);
const iso=value=>Number.isFinite(Date.parse(value??''))?new Date(value).toISOString():null;
const tally=(items,key)=>items.reduce((out,item)=>{const name=key(item)??'UNKNOWN';out[name]=(out[name]??0)+1;return out;},{});
const safeSource=value=>['paper-live-temporal-reference-v1','coinbase-exchange-ticker','biquote-forex-tick',
  'twelvedata-closed-ohlc+biquote-forex-tick','twelvedata-closed-ohlc+coinbase-exchange-ticker'].includes(value)?value:'UNKNOWN';

/** Only positive, persisted references can establish neighboring observations. Absence is UNKNOWN. */
export function analyzeCommissioningMisses({state,history=[]}={}){
  if(state?.schemaVersion!=='paper-final-commissioning-v1'||!state.entries||!Array.isArray(history))
    throw new Error('COMMISSIONING_ANALYSIS_INPUT_INVALID');
  const byId=new Map(history.filter(r=>typeof r?.id==='string').map(r=>[r.id,r]));
  const observations=[];
  for(const [id,entry] of Object.entries(state.entries)){
    const record=byId.get(id);
    if(!record)continue;
    const provider=entry.providerSource??'UNKNOWN',asset=entry.asset;
    const entryAt=record.execution?.status==='PAPER_CONFIRMED'&&record.execution?.paperOnly===true?
      iso(record.execution.actualClickTime):null;
    const exitAt=record.outcomeMetadata?.source==='paper-live-temporal-reference-v1'?
      iso(record.outcomeMetadata.referenceTimestamp):null;
    if(entryAt)observations.push({asset,provider,at:entryAt});
    if(exitAt)observations.push({asset,provider,at:exitAt});
  }
  const misses=[];
  for(const [id,entry] of Object.entries(state.entries)){
    const record=byId.get(id);
    if(!record)continue;
    for(const [reason,type,target] of [
      [entry.entryReferenceMissReason,'ENTRY',entry.plannedClickTime],
      [entry.settlementMissReason,'EXIT',entry.expiryTargetTime]
    ]){
      if(REASONS.get(reason)!==type)continue;
      const plannedReferenceTimestamp=iso(target);
      const start=Date.parse(plannedReferenceTimestamp??'');
      const same=observations.filter(o=>o.asset===entry.asset&&o.provider===entry.providerSource);
      const before=Number.isFinite(start)&&same.some(o=>Date.parse(o.at)<start);
      const after=Number.isFinite(start)&&same.some(o=>Date.parse(o.at)>start+REFERENCE_DEADLINE_MS);
      const providerState=entry.providerHealthAtDecision??'UNKNOWN';
      const rootCauseCategory=plannedReferenceTimestamp?'UNDETERMINED_REFERENCE_MISS':'INVALID_PLANNED_REFERENCE_TIME';
      misses.push({recordId:id,monitorCycleId:entry.monitorCycleId,asset:entry.asset,direction:entry.direction,
        provider:entry.providerSource,plannedReferenceTimestamp,missType:type,providerStateAtDecision:providerState,
        providerReadyAtMiss:'UNKNOWN',initialQuoteAgeMs:Number.isFinite(entry.initialQuoteAgeMs)?entry.initialQuoteAgeMs:null,
        temporalSource:safeSource(type==='EXIT'?record.outcomeMetadata?.source:record.execution?.temporalSource),
        providerObservationBeforeWindow:before?'OBSERVED':'UNKNOWN',providerObservationAfterWindow:after?'OBSERVED':'UNKNOWN',
        rootCauseCategory});
    }
  }
  misses.sort((a,b)=>(a.plannedReferenceTimestamp??'').localeCompare(b.plannedReferenceTimestamp??'')||
    a.recordId.localeCompare(b.recordId)||a.missType.localeCompare(b.missType));
  return {schemaVersion:'commissioning-reference-miss-analysis-v1',readOnly:true,referenceWindowMs:REFERENCE_DEADLINE_MS,
    missCount:misses.length,misses,byAsset:tally(misses,m=>m.asset),byProvider:tally(misses,m=>m.provider),
    byMissType:tally(misses,m=>m.missType),byUtcHour:tally(misses,m=>m.plannedReferenceTimestamp?.slice(0,13)),
    byRootCause:tally(misses,m=>m.rootCauseCategory)};
}

export function analyzeCommissioningSoak(directory){
  const state=JSON.parse(fs.readFileSync(path.join(directory,'commissioning-state.json'),'utf8'));
  const history=JSON.parse(fs.readFileSync(path.join(directory,'will-history-soak.json'),'utf8'));
  return analyzeCommissioningMisses({state,history:Array.isArray(history)?history:history.records});
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  if(process.argv.length!==3)throw new Error('SOAK_DIRECTORY_REQUIRED');
  process.stdout.write(`${JSON.stringify(analyzeCommissioningSoak(path.resolve(process.argv[2])),null,2)}\n`);
}
