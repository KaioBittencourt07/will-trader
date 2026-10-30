import { createHash } from 'node:crypto';
import { canonical, digest, newManifest, canonicalDigest, validateManifest, sameMembership, validTime, validId } from '../../learning/src/cycleEvidenceManifest.js';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function canonicalIds(records) {
  if (!Array.isArray(records)) throw new Error('INVALID_BASELINE_RECORDS');
  const ids=records.map(r=>r?.id);
  if (ids.some(id=>!validId(id)) || new Set(ids).size!==ids.length) throw new Error('INVALID_BASELINE_IDS');
  return [...ids].sort();
}
export function baselineCommitment(records) {
  const ids=canonicalIds(records);
  return {baselineCount:ids.length,baselineIdsSha256:sha256(Buffer.from(JSON.stringify(ids),'utf8'))};
}
// Explicit offline audit utility; never called by the evaluator or membership path.
// Input is the original capture, not a later history containing new records/settlements.
export function auditBaselineBytes(bytes,freeze) {
  if(!Buffer.isBuffer(bytes))throw new Error('INVALID_BASELINE_BYTES');
  const commitment=baselineCommitment(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')));
  const historyFileSha256=sha256(bytes);
  if(commitment.baselineCount!==freeze.baselineCount || commitment.baselineIdsSha256!==freeze.baselineIdsSha256 || historyFileSha256!==freeze.historyFileSha256)throw new Error('INVALID_BASELINE_COMMITMENT');
  return {schemaVersion:'oos2r-baseline-audit-v1',status:'PASS',...commitment,historyFileSha256};
}

// Pure replay: never instantiate the writable journal, recover projections or create locks.
export function replayEvidence(bytes,projections) {
  if (!Buffer.isBuffer(bytes) || !Array.isArray(projections)) throw new Error('INVALID_WAL_INPUT');
  const text=bytes.toString('utf8'), cycles=new Map(), operations=new Map();
  if (text && !text.endsWith('\n')) throw new Error('TRUNCATED_WAL');
  let previousHash=null,sequence=0;
  const require = condition => {if(!condition)throw new Error('INVALID_WAL_EVIDENCE');};
  for(const line of text.split('\n').slice(0,-1)) {
    const e=JSON.parse(line),{hash,...body}=e,p=e.payload;
    require(e.version==='paper-cycle-evidence-wal-v1' && e.sequence===++sequence && e.previousHash===previousHash && hash===digest(body));
    previousHash=hash;
    if(e.type==='CYCLE_OPEN_COMMIT') {
      require(!cycles.has(p.cycleId) && ![...cycles.values()].some(c=>c.manifest.writerGeneration===p.writerGeneration));
      cycles.set(p.cycleId,{manifest:newManifest(p),writers:new Set(),closing:false});continue;
    }
    const c=cycles.get(p.cycleId);require(c && c.manifest.state!=='INVALID');const m=c.manifest;
    if(e.type==='CYCLE_INVALID_COMMIT'){m.state='INVALID';continue;}
    require(m.state==='OPEN' && m.writerGeneration===p.writerGeneration);
    const pending=()=>[...operations.values()].filter(o=>o.p.cycleId===p.cycleId&&!o.committed);
    switch(e.type) {
      case 'WRITER_BEGIN':require(validId(p.writerId)&&!c.writers.has(p.writerId)&&!c.closing);c.writers.add(p.writerId);break;
      case 'WRITER_END':require(c.writers.has(p.writerId)&&!pending().some(o=>o.p.writerId===p.writerId));c.writers.delete(p.writerId);break;
      case 'RECORD_CREATE_INTENT':
        require(!c.closing&&c.writers.has(p.writerId)&&validId(p.operationId)&&validId(p.recordId)&&p.record?.id===p.recordId&&sameMembership(p.record,m)&&p.protocolId===m.protocolId&&p.campaignId===m.campaignId);
        require(!operations.has(p.operationId)&&![...operations.values()].some(o=>o.p.recordId===p.recordId)&&p.record.status!=='CLOSED'&&p.record.outcome==null&&p.record.settledAt==null);
        operations.set(p.operationId,{p,committed:false});break;
      case 'RECORD_CREATE_COMMIT': {
        const o=operations.get(p.operationId);require(o&&!o.committed&&o.p.cycleId===p.cycleId&&o.p.recordId===p.recordId&&c.writers.has(o.p.writerId)&&p.protocolId===m.protocolId&&p.campaignId===m.campaignId);
        o.committed=true;m.recordIds.push(p.recordId);m.expectedRecordCount++;m.inventoryRevision++;m.canonicalDigest=canonicalDigest(m);break;
      }
      case 'CYCLE_SEAL_BEGIN':require(!c.closing);c.closing=true;break;
      case 'CYCLE_SEAL_COMMIT':
        require(c.closing&&!c.writers.size&&!pending().length&&p.canonicalDigest===canonicalDigest(m)&&validTime(p.sealedAt)&&Date.parse(p.sealedAt)>=Date.parse(m.openedAt));
        m.state='SEALED';m.sealedAt=p.sealedAt;m.sealSequence=e.sequence;break;
      default:require(false);
    }
  }
  // Projections are checked, never repaired. A corrupt projection retains its WAL-open slot.
  const projectedIds=projections.map(p=>p?.cycleId);
  require(projectedIds.every(id=>cycles.has(id))&&new Set(projectedIds).size===projectedIds.length);
  return [...cycles.values()].map(({manifest})=>{
    const projection=projections.find(p=>p?.cycleId===manifest.cycleId);let projectionValid=false;
    try{validateManifest(projection);projectionValid=canonical(projection)===canonical(manifest);}catch{}
    const creations=[...operations.values()].filter(o=>o.committed&&o.p.cycleId===manifest.cycleId).map(o=>o.p.record);
    return {manifest,projectionValid,creations};
  });
}
