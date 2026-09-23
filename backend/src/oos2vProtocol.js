export const OOS2V_PROTOCOL='will-edge-gate-oos2v-v1';
export const OOS2V_START_AUTHORIZATION='START_APPROVED_OOS2V_FIRST_COLLECTION_V1';
export const OOS2V_RESTART_AUTHORIZATION='RESTART_APPROVED_OOS2V_EXISTING_COLLECTION_V1';
export const OOS2V_CONTRACT=Object.freeze({
  protocolId:OOS2V_PROTOCOL,mode:'PAPER_READ_ONLY',metric:'MeanAbsMomentum',frozenThreshold:0.599936,operator:'<=',
  candidateCycles:50,selection:'first 50 exact campaign cycles ordered by openedAt then cycleId',replacement:'NONE',
  bootstrap:Object.freeze({unit:'cycle',replications:10000,seed:20260915,rng:'xorshift32'}),
  recoveryInterrupted:Object.freeze({outcome:'RECOVERY_INTERRUPTED',reasonCode:'PROCESS_INTERRUPTION',replacementAllowed:false,performanceEligible:false}),
  expectancy:'NOT_AVAILABLE',noRetuning:true,noEarlyStopping:true,noAutomaticLivePromotion:true,
  automatedBrokerExecution:false,activationAuthorized:false
});
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
export function validateOos2vDraft(value){
  if(!value||['campaignId','edgeCut','evidenceDirectory','baselineCount','baselineIdsSha256','historyFileSha256'].some(k=>Object.hasOwn(value,k))||
    canonical(value)!==canonical(OOS2V_CONTRACT))throw new Error('OOS2V_DRAFT_INVALID');
  return true;
}
