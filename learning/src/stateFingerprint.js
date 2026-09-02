import crypto from 'node:crypto';
export const STATE_FINGERPRINT_VERSION = 'market-state-v1';
export const FAMILIARITY_VERSION = 'familiarity-shadow-v1';
const pick=(source, keys)=>Object.fromEntries(keys.map(key=>[key,source?.[key]??null]));
export function createStateFingerprint({ data={}, decision={}, context={} }={}) {
  // Explicit allow-list guarantees outcomes cannot leak into the state.
  const state={ asset:data.asset??decision.asset??null,timeframe:data.timeframe??decision.timeframe??null, market:pick(data,['volatility','momentum','trend','structure','rangeCompression','rangeExpansion','breakout','rejection','pullback','reversal','exhaustion','featureVersion','featureStatus','source']), decision:pick(decision,['regime','regimeType','regimeStrength','regimeStability','transitionRisk','regimeVersion','setup','setupType','setupDirection','setupQuality','timingStatus','entryQuality','timingVersion']), context:pick(context,['session','hour']), macro:pick(context.marketContext?.macro,['status','source']), news:pick(context.marketContext?.news,['status','source']), mtf:pick(context.mtfContext,['status','agreement','mtfVersion']) };
  const canonical=JSON.stringify(state); return { stateFingerprintVersion:STATE_FINGERPRINT_VERSION, state, hash:crypto.createHash('sha256').update(canonical).digest('hex') };
}
export function assessFamiliarity(fingerprint, historical=[]){const comparable=historical.filter(item=>item?.metadata?.stateFingerprint?.hash);if(comparable.length<5)return { status:'FAMILIARITY_UNKNOWN',similarCaseCount:0,stateDistance:null,familiarityVersion:FAMILIARITY_VERSION };const same=comparable.filter(item=>item.metadata.stateFingerprint.hash===fingerprint.hash).length;return {status:same>=3?'FAMILIAR':same?'LIMITED':'UNFAMILIAR',similarCaseCount:same,stateDistance:same?0:1,familiarityVersion:FAMILIARITY_VERSION};}
