import {clusterBootstrap} from './evaluateOos2.js';
import {replayEvidence} from './oos2rEvidence.js';
import {sameMembership} from '../../learning/src/cycleEvidenceManifest.js';
import {verifyOos2vCycle} from './oos2vEvidence.js';
import {isVerifiedOos2vFreeze,auditOos2vBaselinePrefix} from './oos2vFreeze.js';

const official=r=>r.execution?.status==='PAPER_CONFIRMED'&&
  r.outcomeMetadata?.settlementVersion==='paper-outcome-settlement-v2'&&
  r.outcomeMetadata?.source==='paper-live-temporal-reference-v1'&&['WIN','LOSS','TIE'].includes(r.outcome);
export function evaluateOos2v({history=[],walBytes=Buffer.alloc(0),manifests=[],freeze}={}){
  const report={experiment:'WILL Edge Gate OOS-2V',status:'PRELIMINARY',formalAnalysisAllowed:false,
    freezeIntegrity:'FAIL',baselineIntegrity:'FAIL',evidenceIntegrity:'FAIL',candidateCyclesObserved:0,
    candidateCycleLimit:50,collectionClosed:false,newCandidateAdmissionAllowed:false,sealedCandidateCycles:0,
    invalidCandidateCycles:0,openCandidateCycles:0,completedCandidateCycles:0,incompleteCandidateCycles:0,
    recoveryInterruptedCycles:0,successfulObservationCycles:0,operationalFailureCycles:0,
    replacement:'NONE',noRetuning:true,noEarlyStopping:true,noAutomaticLivePromotion:true,
    mode:'PAPER_READ_ONLY',automatedBrokerExecution:false,ordersExecuted:0,reasonCodes:[]};
  if(!isVerifiedOos2vFreeze(freeze)){report.reasonCodes.push('OOS2V_FREEZE_NOT_AVAILABLE');return report;}
  report.freezeIntegrity='PASS';
  try{auditOos2vBaselinePrefix(history,freeze);report.baselineIntegrity='PASS';}catch{report.reasonCodes.push('BASELINE_AUDIT_REQUIRED');}
  let entries;try{entries=replayEvidence(walBytes,manifests);}catch{report.reasonCodes.push('WAL_UNVERIFIABLE');return report;}
  if(entries.some(e=>e.manifest.protocolId!==freeze.protocolId||e.manifest.campaignId!==freeze.campaignId)){
    report.reasonCodes.push('EVIDENCE_IDENTITY_MISMATCH');return report;
  }
  const cut=Date.parse(freeze.edgeCut);
  if(entries.some(e=>!Number.isFinite(Date.parse(e.manifest.openedAt))||Date.parse(e.manifest.openedAt)<=cut)){
    report.reasonCodes.push('TEMPORAL_MEMBERSHIP_INVALID');return report;
  }
  const candidates=[...entries].sort((a,b)=>Date.parse(a.manifest.openedAt)-Date.parse(b.manifest.openedAt)||
    a.manifest.cycleId.localeCompare(b.manifest.cycleId));
  report.candidateCyclesObserved=candidates.length;report.collectionClosed=candidates.length>=50;
  report.sealedCandidateCycles=candidates.filter(e=>e.manifest.state==='SEALED').length;
  report.invalidCandidateCycles=candidates.filter(e=>e.manifest.state==='INVALID').length;
  report.openCandidateCycles=candidates.filter(e=>e.manifest.state==='OPEN').length;
  const first50=candidates.slice(0,50),checked=first50.map(entry=>verifyOos2vCycle(entry,history));
  report.completedCandidateCycles=checked.filter(c=>c.complete).length;
  report.incompleteCandidateCycles=checked.length-report.completedCandidateCycles;
  report.recoveryInterruptedCycles=checked.filter(c=>c.observationOutcome==='RECOVERY_INTERRUPTED'&&c.valid).length;
  report.successfulObservationCycles=checked.filter(c=>c.observationOutcome==='SUCCESS').length;
  report.operationalFailureCycles=checked.filter(c=>c.observationOutcome==='OPERATIONAL_FAILURE').length;
  const ambiguity=history.some(r=>(r?.protocolId===freeze.protocolId||r?.campaignId===freeze.campaignId)&&
    !first50.some(e=>sameMembership(r,e.manifest)&&e.manifest.recordIds.includes(r.id)&&
      r.metadata?.context?.monitorCycleId===e.manifest.cycleId));
  if(ambiguity)report.reasonCodes.push('MEMBERSHIP_AMBIGUITY');
  if(candidates.length>50)report.reasonCodes.push('POST_FIRST50_EVIDENCE');
  if(candidates.length<50)report.reasonCodes.push('FIRST50_NOT_REACHED');
  if(checked.some(c=>!c.complete))report.reasonCodes.push('FIRST50_NOT_COMPLETE');
  report.evidenceIntegrity=!ambiguity&&candidates.length<=50&&checked.every(c=>c.valid)?'PASS':'FAIL';
  report.newCandidateAdmissionAllowed=report.baselineIntegrity==='PASS'&&report.evidenceIntegrity==='PASS'&&
    candidates.length<50&&report.openCandidateCycles===0&&report.invalidCandidateCycles===0;
  if(report.baselineIntegrity!=='PASS'||report.evidenceIntegrity!=='PASS'||candidates.length!==50||checked.some(c=>!c.complete))return report;
  const evaluated=checked.filter(c=>c.performanceEligible).map(c=>{
    const rows=c.records.filter(official),values=rows.map(r=>r.metadata?.featureSnapshot?.momentum);
    const metricValid=values.length>0&&values.every(Number.isFinite);
    return {rows,metricValid,mean:metricValid?values.reduce((sum,v)=>sum+Math.abs(v),0)/values.length:null};
  });
  const accepted=evaluated.filter(c=>c.metricValid&&c.mean<=freeze.frozenThreshold),rows=accepted.flatMap(c=>c.rows);
  const WIN=rows.filter(r=>r.outcome==='WIN').length,LOSS=rows.filter(r=>r.outcome==='LOSS').length,TIE=rows.filter(r=>r.outcome==='TIE').length;
  report.status='FORMAL_FIRST_50';report.formalAnalysisAllowed=true;
  report.analysis={metric:freeze.metric,threshold:freeze.frozenThreshold,operator:freeze.operator,
    eligibleCycles:evaluated.length,recoveryInterruptedCycles:report.recoveryInterruptedCycles,
    acceptedCycles:accepted.length,rejectedCycles:evaluated.filter(c=>c.metricValid&&c.mean>freeze.frozenThreshold).length,
    invalidMetricCycles:evaluated.filter(c=>!c.metricValid).length,performanceRecords:rows.length,WIN,LOSS,TIE,
    binaryN:WIN+LOSS,binaryWinRate:WIN+LOSS?WIN/(WIN+LOSS):null,primaryCI:clusterBootstrap(rows),
    expectancy:'NOT_AVAILABLE',financialEdge:'NOT_AVAILABLE'};
  return report;
}
