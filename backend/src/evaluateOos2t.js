import { clusterBootstrap } from './evaluateOos2.js';
import { replayEvidence } from './oos2rEvidence.js';
import { sameMembership } from '../../learning/src/cycleEvidenceManifest.js';
import { OOS2T_PROTOCOL,verifyOos2tCycle } from './oos2tEvidence.js';
import {isVerifiedOos2tFreeze,isVerifiedOos2tBaselineAudit} from './oos2tFreeze.js';

const official=r=>r.execution?.status==='PAPER_CONFIRMED'&&r.outcomeMetadata?.settlementVersion==='paper-outcome-settlement-v2'&&r.outcomeMetadata?.source==='paper-live-temporal-reference-v1'&&['WIN','LOSS','TIE'].includes(r.outcome);
const summary=rows=>{const WIN=rows.filter(r=>r.outcome==='WIN').length,LOSS=rows.filter(r=>r.outcome==='LOSS').length,TIE=rows.filter(r=>r.outcome==='TIE').length;return {performanceRecords:rows.length,WIN,LOSS,TIE,binaryN:WIN+LOSS,binaryWinRate:WIN+LOSS?WIN/(WIN+LOSS):null};};
export function evaluateOos2t({history=[],walBytes=Buffer.alloc(0),manifests=[],freeze,baselineAudit}={}) {
  const report={experiment:'WILL Edge Gate OOS-2T',status:'PRELIMINARY',formalAnalysisAllowed:false,freezeIntegrity:'FAIL',baselineIntegrity:'FAIL',evidenceIntegrity:'FAIL',candidateCyclesObserved:0,requiredCandidateCycles:50,completedCandidateCycles:0,observationFailureCycles:0,observationFailureReasonCounts:{},successfulObservationCycles:0,inventoryRecords:0,tradeTerminalRecords:0,noTradeRecords:0,dataInvalidRecords:0,metricValidCycles:0,metricInvalidCycles:0,decisionImpact:'NONE',prospectivePaperAuthorized:false,ordersExecuted:0,reasonCodes:[]};
  if(!isVerifiedOos2tFreeze(freeze)){report.reasonCodes.push('OOS2T_FREEZE_NOT_AVAILABLE');return report;}
  report.freezeIntegrity='PASS';
  if(isVerifiedOos2tBaselineAudit(baselineAudit)&&baselineAudit.baselineCount===freeze.baselineCount&&baselineAudit.baselineIdsSha256===freeze.baselineIdsSha256&&baselineAudit.historyFileSha256===freeze.historyFileSha256)report.baselineIntegrity='PASS';else report.reasonCodes.push('BASELINE_AUDIT_REQUIRED');
  let entries;try{entries=replayEvidence(walBytes,manifests);}catch{report.reasonCodes.push('WAL_UNVERIFIABLE');return report;}
  if(entries.some(e=>e.manifest.protocolId!==freeze.protocolId||e.manifest.campaignId!==freeze.campaignId)){report.reasonCodes.push('EVIDENCE_IDENTITY_MISMATCH');return report;}
  const cut=Date.parse(freeze.edgeCut),campaign=entries;
  if(campaign.some(e=>!Number.isFinite(Date.parse(e.manifest.openedAt))||Date.parse(e.manifest.openedAt)<=cut)){report.evidenceIntegrity='FAIL';report.reasonCodes.push('OOS2T_TEMPORAL_MEMBERSHIP_INVALID');return report;}
  const candidates=campaign.filter(e=>Date.parse(e.manifest.openedAt)>cut).sort((a,b)=>Date.parse(a.manifest.openedAt)-Date.parse(b.manifest.openedAt)||a.manifest.cycleId.localeCompare(b.manifest.cycleId)),selected=candidates.slice(0,50);
  report.candidateCyclesObserved=candidates.length;report.selectedCycleIds=selected.map(e=>e.manifest.cycleId);
  const ambiguity=history.some(r=>(r.protocolId===freeze.protocolId||r.campaignId===freeze.campaignId)&&!campaign.some(e=>sameMembership(r,e.manifest)&&e.manifest.recordIds.includes(r.id)&&r.metadata?.context?.monitorCycleId===e.manifest.cycleId));
  const checked=selected.map(entry=>({...verifyOos2tCycle(entry,history),entry}));
  report.completedCandidateCycles=checked.filter(c=>c.complete).length;report.observationFailureCycles=checked.filter(c=>c.observationOutcome==='OPERATIONAL_FAILURE').length;report.successfulObservationCycles=checked.filter(c=>c.observationOutcome==='SUCCESS').length;
  for(const c of checked.filter(c=>c.observationOutcome==='OPERATIONAL_FAILURE'))report.observationFailureReasonCounts[c.observationFailureReason]=(report.observationFailureReasonCounts[c.observationFailureReason]??0)+1;
  report.observationFailureReasonCounts=Object.fromEntries(Object.entries(report.observationFailureReasonCounts).sort(([a],[b])=>a.localeCompare(b)));
  for(const key of ['inventoryRecords','tradeTerminalRecords','noTradeRecords','dataInvalidRecords'])report[key]=checked.reduce((n,c)=>n+(key==='inventoryRecords'?c.records.length:c[key]),0);
  if(ambiguity)report.reasonCodes.push('MEMBERSHIP_AMBIGUITY');if(selected.length!==50)report.reasonCodes.push('FIRST50_NOT_REACHED');if(checked.some(c=>!c.complete))report.reasonCodes.push('FIRST50_NOT_COMPLETE');
  report.evidenceIntegrity=!ambiguity&&checked.every(c=>c.valid)?'PASS':'FAIL';
  const evaluated=checked.map(c=>{const rows=c.observationOutcome==='SUCCESS'?c.records.filter(official):[],values=rows.map(r=>r.metadata?.featureSnapshot?.momentum),metricValid=values.length>0&&values.every(Number.isFinite);return {...c,rows,metricValid,mean:metricValid?values.reduce((s,v)=>s+Math.abs(v),0)/values.length:null};});
  report.metricValidCycles=evaluated.filter(c=>c.metricValid).length;report.metricInvalidCycles=evaluated.filter(c=>!c.metricValid).length;
  if(report.baselineIntegrity!=='PASS'||ambiguity||selected.length!==50||checked.some(c=>!c.complete))return report;
  const accepted=evaluated.filter(c=>c.metricValid&&c.mean<=0.599936),performance=accepted.flatMap(c=>c.rows);
  report.status='FORMAL_FIRST_50';report.formalAnalysisAllowed=true;report.analysis={metric:'MeanAbsMomentum',threshold:.599936,operator:'<=',acceptedCycles:accepted.length,rejectedCycles:evaluated.filter(c=>c.metricValid&&c.mean>.599936).length,invalidMetricCycles:report.metricInvalidCycles,...summary(performance),primaryCI:clusterBootstrap(performance),expectancy:'NOT_AVAILABLE',financialEdge:'NOT_AVAILABLE'};return report;
}
