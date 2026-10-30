import { readFileSync } from 'node:fs';
import { clusterBootstrap } from './evaluateOos2.js';
import { sha256, canonicalIds, replayEvidence } from './oos2rEvidence.js';
import { verifyManifestAgainstHistory, sameMembership, validTime, canonical } from '../../learning/src/cycleEvidenceManifest.js';

export const EXPECTED_OOS2R_FREEZE_SHA256='f61df0aecdd9336cdd3df52b51dbb32fd74094ed680a85ff4d2490e5ac101892';
const freezePath=new URL('../config/experiments/edge-gate-oos2r-freeze.json',import.meta.url);
const verified=new WeakSet();
function lock(value){if(value&&typeof value==='object'){Object.values(value).forEach(lock);Object.freeze(value);}return value;}
export function readOos2rFreeze(file=freezePath) {
  const bytes=readFileSync(file);
  if(sha256(bytes)!==EXPECTED_OOS2R_FREEZE_SHA256)throw new Error('INVALID_OOS2R_FREEZE_SHA256');
  const freeze=lock(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')));verified.add(freeze);return freeze;
}
const compare=(a,b)=>a<b?-1:a>b?1:0;
const official=r=>r.execution?.status==='PAPER_CONFIRMED'&&r.outcomeMetadata?.settlementVersion==='paper-outcome-settlement-v2'&&r.outcomeMetadata?.source==='paper-live-temporal-reference-v1'&&['WIN','LOSS','TIE'].includes(r.outcome);
function summary(records) {
  const n=label=>records.filter(r=>r.outcome===label).length;
  const W=n('WIN'),L=n('LOSS');
  return {N:records.length,WIN:W,LOSS:L,TIE:n('TIE'),DATA_INVALID:n('DATA_INVALID'),binaryN:W+L,binaryWinRate:W+L?W/(W+L):null,expectancy:'NOT_AVAILABLE',financialEdge:'NOT_AVAILABLE'};
}

// No CLI/network/monitor/broker entrypoint. Caller supplies a coherent read-only snapshot.
// No partial performance is computed or returned before all formal gates pass.
export function evaluateOos2r({history,walBytes,manifests,freeze=readOos2rFreeze(),baselineAudit=null}={}) {
  const report={experiment:'WILL Edge Gate OOS-2R',status:'PRELIMINARY',formalAnalysisAllowed:false,
    freezeIntegrity:'FAIL',baselineIntegrity:'FAIL',evidenceIntegrity:'FAIL',candidateCyclesObserved:0,
    selectedCycleIds:[],completedCandidateCycles:0,invalidCycles:0,requiredCandidateCycles:50,
    decisionImpact:'NONE',prospectivePaperAuthorized:false,ordersExecuted:0,reasonCodes:[]};
  if(!verified.has(freeze)){report.reasonCodes.push('UNVERIFIED_FREEZE');return report;}
  report.freezeIntegrity='PASS';report.edgeCut=freeze.edgeCut;
  let entries;
  try {
    canonicalIds(history);
  }catch{report.reasonCodes.push('HISTORY_IDS_INVALID');return report;}
  // External operator audit attestation, NOT authentication and NOT membership.
  // Never infer that the current history contains the old ID set from matching counts.
  if(baselineAudit?.schemaVersion==='oos2r-baseline-audit-v1'&&baselineAudit.status==='PASS'&&
    baselineAudit.baselineCount===freeze.baselineCount&&baselineAudit.baselineIdsSha256===freeze.baselineIdsSha256&&baselineAudit.historyFileSha256===freeze.historyFileSha256)report.baselineIntegrity='PASS';
  else report.reasonCodes.push('BASELINE_AUDIT_REQUIRED');
  try{entries=replayEvidence(walBytes,manifests);}catch{report.reasonCodes.push('WAL_UNVERIFIABLE_OR_UNORDERABLE');return report;}
  const cut=Date.parse(freeze.edgeCut);
  const campaign=entries.filter(({manifest:m})=>m.protocolId===freeze.protocolId&&m.campaignId===freeze.campaignId);
  const candidates=campaign.filter(({manifest:m})=>Date.parse(m.openedAt)>cut).sort((a,b)=>Date.parse(a.manifest.openedAt)-Date.parse(b.manifest.openedAt)||compare(a.manifest.cycleId,b.manifest.cycleId));
  const selected=candidates.slice(0,50);report.candidateCyclesObserved=candidates.length;report.selectedCycleIds=selected.map(e=>e.manifest.cycleId);
  // No record can claim this campaign without its authoritative inventory/membership.
  const ambiguity=history.some(r=>{
    if(r.protocolId!==freeze.protocolId&&r.campaignId!==freeze.campaignId)return false;
    const e=campaign.find(e=>e.manifest.cycleId===r.cycleId);
    return !e||!sameMembership(r,e.manifest)||!e.manifest.recordIds.includes(r.id)||r.metadata?.context?.monitorCycleId!==r.cycleId;
  });
  const checked=selected.map(e=>{
    const m=e.manifest,rows=history.filter(r=>r.cycleId===m.cycleId||r.metadata?.context?.monitorCycleId===m.cycleId);
    const verification=verifyManifestAgainstHistory(m,history);
    const temporal=rows.every(r=>validTime(r.settledAt)&&Date.parse(r.settledAt)>=Date.parse(m.openedAt));
    const provenance=rows.every(r=>r.outcome==='DATA_INVALID'||official(r));
    const creationConsistent=rows.every(r=>{
      const initial=e.creations.find(x=>x.id===r.id);
      return initial && canonical(initial.metadata?.featureSnapshot??null)===canonical(r.metadata?.featureSnapshot??null);
    });
    const valid=e.projectionValid&&verification.valid&&creationConsistent;
    return {m,rows,valid,complete:valid&&verification.complete&&temporal&&provenance};
  });
  report.invalidCycles=checked.filter(c=>!c.valid).length;
  report.completedCandidateCycles=checked.filter(c=>c.complete).length;
  report.evidenceIntegrity=ambiguity||checked.some(c=>!c.valid)?'FAIL':'PASS';
  if(ambiguity)report.reasonCodes.push('MEMBERSHIP_AMBIGUITY');
  if(selected.length!==50)report.reasonCodes.push('FIRST50_NOT_REACHED');
  if(checked.some(c=>!c.complete))report.reasonCodes.push('FIRST50_NOT_COMPLETE');
  if(report.baselineIntegrity!=='PASS'||ambiguity||selected.length!==50||checked.some(c=>!c.complete))return report;
  report.status='FORMAL_FIRST_50';report.formalAnalysisAllowed=true;
  // Only now inspect momentum or aggregate terminal labels.
  const evaluated=checked.map(c=>{
    const rows=c.rows.filter(official),values=rows.map(r=>r.metadata?.featureSnapshot?.momentum);
    const valid=values.length>0&&values.every(v=>typeof v==='number'&&Number.isFinite(v));
    const mean=valid?values.reduce((sum,v)=>sum+Math.abs(v),0)/values.length:null;
    return {...c,official:rows,metricValid:valid&&Number.isFinite(mean),mean};
  });
  const accepted=evaluated.filter(c=>c.metricValid&&c.mean<=freeze.frozenThreshold);
  const acceptedRecords=accepted.flatMap(c=>c.official),all=checked.flatMap(c=>c.rows);
  const groups={};
  const fields={asset:r=>r.asset,direction:r=>r.direction,regime:r=>r.regime,
    setup:r=>r.setup,utcHour:r=>checked.find(c=>c.m.cycleId===r.cycleId).m.openedAt.slice(11,13)};
  for(const [field,get] of Object.entries(fields)) {
    const buckets=new Map();for(const r of acceptedRecords){const value=get(r);const key=typeof value==='string'?value:'UNKNOWN';if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(r);}
    groups[field]=[...buckets].sort(([a],[b])=>compare(a,b)).map(([label,rows])=>({label,...summary(rows)}));
  }
  report.analysis={metric:'MeanAbsMomentum',threshold:freeze.frozenThreshold,operator:freeze.operator,
    allSelected:summary(all),accepted:summary(acceptedRecords),acceptedCycles:accepted.length,
    rejectedCycles:evaluated.filter(c=>c.metricValid&&c.mean>freeze.frozenThreshold).length,
    invalidMetricCycles:evaluated.filter(c=>!c.metricValid).length,
    coverageAllCandidates:accepted.length/50,
    coverageValidCandidates:evaluated.some(c=>c.metricValid)?accepted.length/evaluated.filter(c=>c.metricValid).length:null,
    primaryCI:clusterBootstrap(acceptedRecords),exploratoryGroups:groups,
    comparison:{interpretation:'Descriptive only; OOS-1 retrospectively used for operator selection; no prior OOS-2 results loaded',
      frozenAcceptedIS:{WIN:26,LOSS:18,TIE:2},frozenAcceptedOOS1:{WIN:32,LOSS:31,TIE:4}},
    expectancy:'NOT_AVAILABLE',financialEdge:'NOT_AVAILABLE'};
  return report;
}
