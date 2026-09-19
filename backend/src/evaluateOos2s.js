import { clusterBootstrap } from './evaluateOos2.js';
import { canonicalIds,replayEvidence } from './oos2rEvidence.js';
import { sameMembership } from '../../learning/src/cycleEvidenceManifest.js';
import { readOos2sFreeze,isVerifiedOos2sFreeze } from './oos2sFreeze.js';
import { verifyOos2sCycle } from './oos2sEvidence.js';

const official=r=>r.execution?.status==='PAPER_CONFIRMED'&&r.outcomeMetadata?.settlementVersion==='paper-outcome-settlement-v2'&&r.outcomeMetadata?.source==='paper-live-temporal-reference-v1'&&['WIN','LOSS','TIE'].includes(r.outcome);
const summarize=rows=>{const WIN=rows.filter(r=>r.outcome==='WIN').length,LOSS=rows.filter(r=>r.outcome==='LOSS').length,TIE=rows.filter(r=>r.outcome==='TIE').length;return {performanceRecords:rows.length,WIN,LOSS,TIE,binaryN:WIN+LOSS,binaryWinRate:WIN+LOSS?WIN/(WIN+LOSS):null};};

export function evaluateOos2s({history,walBytes,manifests,freeze=readOos2sFreeze(),baselineAudit=null}={}) {
  const report={experiment:'WILL Edge Gate OOS-2S',status:'PRELIMINARY',formalAnalysisAllowed:false,freezeIntegrity:'PASS',baselineIntegrity:'FAIL',evidenceIntegrity:'FAIL',candidateCyclesObserved:0,requiredCandidateCycles:50,decisionImpact:'NONE',prospectivePaperAuthorized:false,ordersExecuted:0,reasonCodes:[]};
  if(!isVerifiedOos2sFreeze(freeze)){report.freezeIntegrity='FAIL';report.reasonCodes.push('UNVERIFIED_FREEZE');return report;}
  try{canonicalIds(history);}catch{report.reasonCodes.push('HISTORY_IDS_INVALID');return report;}
  if(baselineAudit?.schemaVersion==='oos2s-baseline-audit-v1'&&baselineAudit?.status==='PASS'&&baselineAudit.baselineCount===freeze.baselineCount&&baselineAudit.baselineIdsSha256===freeze.baselineIdsSha256&&baselineAudit.historyFileSha256===freeze.historyFileSha256)report.baselineIntegrity='PASS';else report.reasonCodes.push('BASELINE_AUDIT_REQUIRED');
  let entries;try{entries=replayEvidence(walBytes,manifests);}catch{report.reasonCodes.push('WAL_UNVERIFIABLE');return report;}
  const cut=Date.parse(freeze.edgeCut),campaign=entries.filter(e=>e.manifest.protocolId===freeze.protocolId&&e.manifest.campaignId===freeze.campaignId);
  const candidates=campaign.filter(e=>Date.parse(e.manifest.openedAt)>cut).sort((a,b)=>Date.parse(a.manifest.openedAt)-Date.parse(b.manifest.openedAt)||a.manifest.cycleId.localeCompare(b.manifest.cycleId)),selected=candidates.slice(0,50);
  report.candidateCyclesObserved=candidates.length;report.selectedCycleIds=selected.map(e=>e.manifest.cycleId);
  const ambiguity=history.some(r=>(r.protocolId===freeze.protocolId||r.campaignId===freeze.campaignId)&&!campaign.some(e=>sameMembership(r,e.manifest)&&e.manifest.recordIds.includes(r.id)&&r.metadata?.context?.monitorCycleId===e.manifest.cycleId));
  const checked=selected.map(entry=>({...verifyOos2sCycle(entry,history),entry}));
  report.inventoryRecords=checked.reduce((n,c)=>n+c.records.length,0);report.tradeTerminalRecords=checked.reduce((n,c)=>n+c.tradeTerminalRecords,0);report.noTradeRecords=checked.reduce((n,c)=>n+c.noTradeRecords,0);report.dataInvalidRecords=checked.reduce((n,c)=>n+c.dataInvalidRecords,0);
  report.completedCandidateCycles=checked.filter(c=>c.complete).length;report.invalidCycles=checked.filter(c=>!c.valid).length;
  if(ambiguity)report.reasonCodes.push('MEMBERSHIP_AMBIGUITY');if(selected.length!==50)report.reasonCodes.push('FIRST50_NOT_REACHED');if(checked.some(c=>!c.complete))report.reasonCodes.push('FIRST50_NOT_COMPLETE');
  report.evidenceIntegrity=!ambiguity&&checked.every(c=>c.valid)?'PASS':'FAIL';
  if(report.baselineIntegrity!=='PASS'||ambiguity||selected.length!==50||checked.some(c=>!c.complete))return report;
  const evaluated=checked.map(c=>{const rows=c.records.filter(official),values=rows.map(r=>r.metadata?.featureSnapshot?.momentum),metricValid=values.length>0&&values.every(Number.isFinite);return {...c,rows,metricValid,mean:metricValid?values.reduce((s,v)=>s+Math.abs(v),0)/values.length:null};});
  const accepted=evaluated.filter(c=>c.metricValid&&c.mean<=freeze.frozenThreshold),performance=accepted.flatMap(c=>c.rows);
  const exploratoryGroups={};for(const [field,get] of Object.entries({asset:r=>r.asset,direction:r=>r.direction,regime:r=>r.regime})) {const buckets=new Map();for(const r of performance){const key=String(get(r)??'UNKNOWN');if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(r);}exploratoryGroups[field]=[...buckets].sort(([a],[b])=>a.localeCompare(b)).map(([label,rows])=>({label,...summarize(rows)}));}
  report.status='FORMAL_FIRST_50';report.formalAnalysisAllowed=true;report.analysis={metric:'MeanAbsMomentum',threshold:0.599936,operator:'<=',acceptedCycles:accepted.length,rejectedCycles:evaluated.filter(c=>c.metricValid&&c.mean>0.599936).length,invalidMetricCycles:evaluated.filter(c=>!c.metricValid).length,...summarize(performance),primaryCI:clusterBootstrap(performance),expectancy:'NOT_AVAILABLE',financialEdge:'NOT_AVAILABLE',exploratoryGroups};return report;
}
