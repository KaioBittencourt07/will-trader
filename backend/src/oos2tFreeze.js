import fs from 'node:fs';import {fileURLToPath} from 'node:url';
import {baselineCommitment,sha256} from './oos2rEvidence.js';import {OOS2T_PROTOCOL} from './oos2tEvidence.js';
const verifiedFreezes=new WeakSet(),verifiedAudits=new WeakSet();
const deepFreeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(deepFreeze);Object.freeze(value);}return value;};
export const isVerifiedOos2tFreeze=value=>verifiedFreezes.has(value);
export const isVerifiedOos2tBaselineAudit=value=>verifiedAudits.has(value);
export function readOos2tFreeze(file,hashFile) {
  if(!file||!hashFile)throw new Error('OOS2T_FREEZE_PATHS_REQUIRED');
  const filePath=file instanceof URL?fileURLToPath(file):file,sidecar=hashFile instanceof URL?fileURLToPath(hashFile):hashFile;
  const expected=fs.readFileSync(sidecar,'utf8').trim().toLowerCase();if(!/^[a-f0-9]{64}$/.test(expected))throw new Error('OOS2T_FREEZE_INVALID');
  const bytes=fs.readFileSync(filePath);if(sha256(bytes)!==expected)throw new Error('OOS2T_FREEZE_INVALID');
  const v=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
  if(v.schemaVersion!=='edge-gate-oos2t-freeze-v1'||v.policy!=='IMMUTABLE_AFTER_FREEZE'||v.protocolId!==OOS2T_PROTOCOL||typeof v.campaignId!=='string'||!v.campaignId||
    !Number.isFinite(Date.parse(v.edgeCut))||v.metric!=='MeanAbsMomentum'||v.frozenThreshold!==0.599936||v.operator!=='<='||!Number.isSafeInteger(v.baselineCount)||v.baselineCount<0||
    !/^[a-f0-9]{64}$/i.test(v.baselineIdsSha256??'')||!/^[a-f0-9]{64}$/i.test(v.historyFileSha256??'')||v.checkpoint?.candidateCycles!==50||
    v.bootstrap?.unit!=='cycle'||v.bootstrap?.replications!==10000||v.bootstrap?.seed!==20260915||v.bootstrap?.rng!=='xorshift32'||!/^[a-f0-9]{40}$/i.test(v.sourceHead??'')||!Number.isFinite(Date.parse(v.createdAt))||Date.parse(v.createdAt)<Date.parse(v.edgeCut)||v.noRetuning!==true||v.noEarlyStopping!==true||v.noAutomaticLivePromotion!==true||v.activationAuthorized!==false)throw new Error('OOS2T_FREEZE_INVALID');
  const result=deepFreeze({...v,freezeSha256:expected});verifiedFreezes.add(result);return result;
}
export function auditOos2tBaselineBytes(bytes,freeze) {
  if(!Buffer.isBuffer(bytes)||!isVerifiedOos2tFreeze(freeze))throw new Error('OOS2T_BASELINE_AUDIT_INVALID');
  const commitment=baselineCommitment(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''))),historyFileSha256=sha256(bytes);
  if(commitment.baselineCount!==freeze.baselineCount||commitment.baselineIdsSha256!==freeze.baselineIdsSha256||historyFileSha256!==freeze.historyFileSha256)throw new Error('OOS2T_BASELINE_AUDIT_FAILED');
  const result=deepFreeze({schemaVersion:'oos2t-baseline-audit-v1',status:'PASS',...commitment,historyFileSha256});verifiedAudits.add(result);return result;
}
