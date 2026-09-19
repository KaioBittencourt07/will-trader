import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sha256 } from './oos2rEvidence.js';
import { OOS2S_PROTOCOL,OOS2S_CAMPAIGN } from './oos2sEvidence.js';

export const OOS2S_FREEZE_PATH=new URL('../config/experiments/edge-gate-oos2s-freeze.json',import.meta.url);
const verified=new WeakSet();
export const isVerifiedOos2sFreeze=value=>verified.has(value);
export function readOos2sFreeze(file=OOS2S_FREEZE_PATH,hashFile=null) {
  const filePath=file instanceof URL?fileURLToPath(file):file;
  const sidecar=hashFile??`${filePath}.sha256`;
  const expected=fs.readFileSync(sidecar,'utf8').trim().toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(expected))throw new Error('OOS2S_FREEZE_INVALID');
  const bytes=fs.readFileSync(filePath);
  if(sha256(bytes)!==expected)throw new Error('OOS2S_FREEZE_INVALID');
  const value=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
  if(value.schemaVersion!=='edge-gate-oos2s-freeze-v1'||value.policy!=='IMMUTABLE_AFTER_FREEZE'||value.protocolId!==OOS2S_PROTOCOL||value.campaignId!==OOS2S_CAMPAIGN||
    value.frozenThreshold!==0.599936||value.operator!=='<='||value.metric!=='MeanAbsMomentum'||value.rawQ50!==0.599936477924654||value.baselineCount!==1108||
    !/^[a-f0-9]{64}$/i.test(value.baselineIdsSha256??'')||value.historyFileSha256!=='4205d3e27ec6e374c3a3a746f19e9f85edd4b83772c3cb3bda35d8985f06d6ca'||
    !Number.isFinite(Date.parse(value.edgeCut))||value.createdAt!==value.edgeCut||value.checkpoint?.candidateCycles!==50||value.bootstrap?.replications!==10000||value.bootstrap?.seed!==20260915||value.bootstrap?.rng!=='xorshift32'||
    value.noRetuning!==true||value.noEarlyStopping!==true||value.noAutomaticLivePromotion!==true||value.activationAuthorized!==false)throw new Error('OOS2S_FREEZE_INVALID');
  const result=Object.freeze({...value,freezeSha256:expected});verified.add(result);return result;
}
