import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {canonical} from '../../learning/src/cycleEvidenceManifest.js';
import {baselineCommitment,sha256} from './oos2rEvidence.js';
import {baselineRecordsDigest} from './oos2uFreeze.js';
import {OOS2V_CONTRACT,OOS2V_PROTOCOL} from './oos2vProtocol.js';

const verified=new WeakSet();
const keys=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join('|')===[...expected].sort().join('|');
const deepFreeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(deepFreeze);Object.freeze(value);}return value;};
export const isVerifiedOos2vFreeze=value=>verified.has(value);
export function readOos2vFreeze(file,hashFile){
  if(!file||!hashFile)throw new Error('OOS2V_FREEZE_PATHS_REQUIRED');
  const target=file instanceof URL?fileURLToPath(file):file,sidecar=hashFile instanceof URL?fileURLToPath(hashFile):hashFile;
  const expected=fs.readFileSync(sidecar,'utf8').trim().toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(expected))throw new Error('OOS2V_FREEZE_INVALID');
  const bytes=fs.readFileSync(target);
  if(sha256(bytes)!==expected)throw new Error('OOS2V_FREEZE_INVALID');
  const value=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')),c=OOS2V_CONTRACT;
  if(!keys(value,['schemaVersion','policy','experiment','protocolId','campaignId','edgeCut','createdAt','sourceHead',
    'mode','metric','frozenThreshold','operator','baselineCount','baselineIdsSha256','baselineRecordsSha256',
    'historyFileSha256','checkpoint','bootstrap','recoveryInterrupted','expectancy','noRetuning','noEarlyStopping',
    'noAutomaticLivePromotion','automatedBrokerExecution','activationAuthorized'])||
    !keys(value.checkpoint,['candidateCycles','selection','replacement'])||
    canonical(value.checkpoint)!==canonical({candidateCycles:c.candidateCycles,selection:c.selection,replacement:c.replacement})||
    canonical(value.bootstrap)!==canonical(c.bootstrap)||canonical(value.recoveryInterrupted)!==canonical(c.recoveryInterrupted)||
    value.schemaVersion!=='edge-gate-oos2v-freeze-v1'||value.policy!=='IMMUTABLE_AFTER_FREEZE'||
    value.experiment!=='WILL Edge Gate OOS-2V'||value.protocolId!==OOS2V_PROTOCOL||
    typeof value.campaignId!=='string'||!value.campaignId||!Number.isFinite(Date.parse(value.edgeCut))||
    !Number.isFinite(Date.parse(value.createdAt))||Date.parse(value.createdAt)<Date.parse(value.edgeCut)||
    !/^[a-f0-9]{40}$/i.test(value.sourceHead??'')||
    !Number.isSafeInteger(value.baselineCount)||value.baselineCount<0||
    ['baselineIdsSha256','baselineRecordsSha256','historyFileSha256'].some(k=>!/^[a-f0-9]{64}$/i.test(value[k]??''))||
    ['mode','metric','frozenThreshold','operator','expectancy','noRetuning','noEarlyStopping','noAutomaticLivePromotion',
      'automatedBrokerExecution','activationAuthorized'].some(k=>value[k]!==c[k]))throw new Error('OOS2V_FREEZE_INVALID');
  const result=deepFreeze({...value,freezeSha256:expected});verified.add(result);return result;
}
export function auditOos2vBaselinePrefix(history,freeze){
  if(!isVerifiedOos2vFreeze(freeze)||!Array.isArray(history)||history.length<freeze.baselineCount)throw new Error('OOS2V_BASELINE_INVALID');
  const prefix=history.slice(0,freeze.baselineCount),commitment=baselineCommitment(prefix);
  if(commitment.baselineCount!==freeze.baselineCount||commitment.baselineIdsSha256!==freeze.baselineIdsSha256||
    baselineRecordsDigest(prefix)!==freeze.baselineRecordsSha256)throw new Error('OOS2V_BASELINE_INVALID');
  return Object.freeze({status:'PASS',...commitment});
}
export function auditOos2vBaselineBytes(bytes,freeze){
  if(!Buffer.isBuffer(bytes)||!isVerifiedOos2vFreeze(freeze)||sha256(bytes)!==freeze.historyFileSha256)throw new Error('OOS2V_BASELINE_INVALID');
  const rows=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
  if(rows.length!==freeze.baselineCount)throw new Error('OOS2V_BASELINE_INVALID');
  return auditOos2vBaselinePrefix(rows,freeze);
}
