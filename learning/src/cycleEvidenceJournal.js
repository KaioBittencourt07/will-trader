import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, digest, validId, validTime, newManifest, canonicalDigest, validateManifest,
  sameMembership, verifyManifestAgainstHistory } from './cycleEvidenceManifest.js';

const VERSION = 'paper-cycle-evidence-wal-v1';
const fail = code => { throw new Error(code); };
const clone = value => JSON.parse(canonical(value));

// Explicit opt-in storage directory. No imports of runtime, historyStore, or providers.
export function createCycleEvidenceJournal({ directory, fault = () => {}, observationTerminalRequired = false } = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) fail('ABSOLUTE_JOURNAL_DIRECTORY_REQUIRED');
  fs.mkdirSync(directory, { recursive: true });
  const walPath = path.join(directory,'journal.jsonl'), lockPath = path.join(directory,'writer.lock');
  const quarantinePath = path.join(directory,'INVALID');
  function flushWrite(file, data, flags = 'w') {
    const fd = fs.openSync(file,flags);
    try { fs.writeFileSync(fd,data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  function project(file, value) {
    const temp = `${file}.${randomUUID()}.tmp`;
    flushWrite(temp, canonical(value)); fs.renameSync(temp,file);
  }
  const manifestPath = id => path.join(directory,`${digest(id)}.manifest.json`);
  function locked(fn) {
    let fd;
    try { fd=fs.openSync(lockPath,'wx'); } catch { fail('JOURNAL_LOCKED'); }
    try {
      if (fs.existsSync(quarantinePath)) fail('JOURNAL_INVALID');
      return fn();
    } finally { fs.closeSync(fd); fs.unlinkSync(lockPath); }
  }
  function quarantine() { flushWrite(quarantinePath,'JOURNAL_INVALID'); }
  function apply(state, e) {
    const p=e.payload, m=state.cycles.get(p.cycleId);
    if (e.type === 'CYCLE_OPEN_COMMIT') {
      if (m || [...state.cycles.values()].some(x => x.writerGeneration === p.writerGeneration)) fail('WAL_SEQUENCE_INVALID');
      const fresh=newManifest(p); state.cycles.set(p.cycleId,fresh);
      state.writers.set(p.cycleId,new Set()); state.observationTerminals.set(p.cycleId,null); return;
    }
    if (!m || m.state === 'INVALID') fail('WAL_SEQUENCE_INVALID');
    if (e.type === 'CYCLE_INVALID_COMMIT') { m.state='INVALID'; return; }
    if (m.state !== 'OPEN' || p.writerGeneration !== m.writerGeneration) fail('WAL_SEQUENCE_INVALID');
    const writers=state.writers.get(p.cycleId);
    if (e.type === 'WRITER_BEGIN') {
      if (!validId(p.writerId) || writers.has(p.writerId) || state.closing.has(m.cycleId) || state.observationTerminals.get(m.cycleId)) fail('WAL_SEQUENCE_INVALID');
      writers.add(p.writerId);
    } else if (e.type === 'WRITER_END') {
      if (!writers.has(p.writerId) || [...state.operations.values()].some(o=>!o.committed && o.payload.writerId===p.writerId && o.payload.cycleId===m.cycleId)) fail('WAL_SEQUENCE_INVALID');
      writers.delete(p.writerId);
    } else if (e.type === 'RECORD_CREATE_INTENT') {
      if (!writers.has(p.writerId) || state.closing.has(m.cycleId) || state.observationTerminals.get(m.cycleId) || !validId(p.operationId) || !validId(p.recordId) ||
        p.record?.id !== p.recordId || !sameMembership(p.record,m) || p.protocolId !== m.protocolId || p.campaignId !== m.campaignId ||
        state.operations.has(p.operationId) || [...state.operations.values()].some(o=>o.payload.recordId===p.recordId)) fail('WAL_SEQUENCE_INVALID');
      if (p.record.settledAt != null || p.record.outcome != null || p.record.status === 'CLOSED') fail('INITIAL_RECORD_ALREADY_RESOLVED');
      state.operations.set(p.operationId,{payload:p,committed:false});
    } else if (e.type === 'RECORD_BATCH_READY') {
      if (!writers.has(p.writerId) || !validId(p.batchId) || !Array.isArray(p.operationIds) || !p.operationIds.length ||
        new Set(p.operationIds).size!==p.operationIds.length || state.batches.has(p.batchId)) fail('WAL_SEQUENCE_INVALID');
      for (const id of p.operationIds) {
        const op=state.operations.get(id);
        if (!op || op.committed || op.batchId || op.payload.cycleId!==m.cycleId || op.payload.writerId!==p.writerId) fail('WAL_SEQUENCE_INVALID');
        op.batchId=p.batchId;
      }
      state.batches.set(p.batchId,{payload:p});
    } else if (e.type === 'RECORD_CREATE_COMMIT') {
      const op=state.operations.get(p.operationId);
      if (!op || op.committed || op.payload.cycleId !== m.cycleId || op.payload.recordId !== p.recordId ||
        p.protocolId !== m.protocolId || p.campaignId !== m.campaignId || !writers.has(op.payload.writerId)) fail('WAL_SEQUENCE_INVALID');
      op.committed=true; m.recordIds.push(p.recordId); m.expectedRecordCount++; m.inventoryRevision++;
      m.canonicalDigest=canonicalDigest(m);
    } else if (e.type === 'CYCLE_OBSERVATION_COMMIT') {
      const validTerminal=p.outcome==='SUCCESS'?(p.reasonCode===null||p.reasonCode===undefined):p.outcome==='OPERATIONAL_FAILURE'&&m.recordIds.length===0&&/^[A-Z][A-Z0-9_]{0,63}$/.test(p.reasonCode??'');
      if (!validTerminal || state.observationTerminals.get(m.cycleId) || writers.size || [...state.operations.values()].some(o=>o.payload.cycleId===m.cycleId&&!o.committed) || state.closing.has(m.cycleId)) fail('WAL_SEQUENCE_INVALID');
      state.observationTerminals.set(m.cycleId,Object.freeze({outcome:p.outcome,reasonCode:p.reasonCode??null,sequence:e.sequence}));
    } else if (e.type === 'CYCLE_SEAL_BEGIN') {
      if (observationTerminalRequired && !state.observationTerminals.get(m.cycleId)) fail('WAL_SEQUENCE_INVALID');
      if (state.closing.has(m.cycleId)) fail('WAL_SEQUENCE_INVALID');
      state.closing.add(m.cycleId);
    } else if (e.type === 'CYCLE_SEAL_COMMIT') {
      if (!state.closing.has(m.cycleId) || writers.size || [...state.operations.values()].some(o=>o.payload.cycleId===m.cycleId && !o.committed) ||
        p.canonicalDigest !== canonicalDigest(m) || !validTime(p.sealedAt)) fail('WAL_SEQUENCE_INVALID');
      validateManifest(m); m.state='SEALED'; m.sealedAt=p.sealedAt; m.sealSequence=e.sequence;
    } else fail('WAL_EVENT_INVALID');
  }
  function replay() {
    const state={cycles:new Map(),writers:new Map(),operations:new Map(),batches:new Map(),closing:new Set(),observationTerminals:new Map(),events:[],projections:new Set()};
    if (!fs.existsSync(walPath)) {
      if (fs.readdirSync(directory).some(name=>name.endsWith('.manifest.json'))) { quarantine(); fail('WAL_MISSING'); }
      return state;
    }
    try {
      const bytes=fs.readFileSync(walPath,'utf8');
      if (!bytes && fs.readdirSync(directory).some(name=>name.endsWith('.manifest.json'))) fail('WAL_EMPTY_WITH_PROJECTION');
      if (bytes && !bytes.endsWith('\n')) fail('WAL_TRUNCATED');
      for (const line of bytes.split('\n').slice(0,-1)) {
        const e=JSON.parse(line), {hash,...body}=e;
        if (e.version !== VERSION || e.sequence !== state.events.length+1 ||
          e.previousHash !== (state.events.at(-1)?.hash ?? null) || hash !== digest(body)) fail('WAL_CORRUPT');
        apply(state,e); state.events.push(e); state.projections.add(canonical(state.cycles.get(e.payload.cycleId)));
      }
      return state;
    } catch { quarantine(); fail('JOURNAL_INVALID'); }
  }
  function append(state,type,payload) {
    const body={version:VERSION,sequence:state.events.length+1,previousHash:state.events.at(-1)?.hash??null,type,payload:clone(payload)};
    const e={...body,hash:digest(body)};
    fault('BEFORE_APPEND',type);
    // Any uncertain append quarantines this instance's directory; never continue a torn tail.
    try { flushWrite(walPath,`${canonical(e)}\n`,'a'); } catch { quarantine(); fail('WAL_WRITE_UNCERTAIN'); }
    fault('AFTER_WAL_COMMIT',type);
    apply(state,e); state.events.push(e); state.projections.add(canonical(state.cycles.get(payload.cycleId)));
    project(manifestPath(payload.cycleId),state.cycles.get(payload.cycleId));
    fault('AFTER_PROJECTION',type);
  }
  function get(state,cycleId) { const m=state.cycles.get(cycleId); if (!m) fail('CYCLE_NOT_FOUND'); return m; }
  function invalidate(state,m) {
    if (m.state !== 'INVALID') append(state,'CYCLE_INVALID_COMMIT',{cycleId:m.cycleId});
  }
  function generation(state,m,value) {
    if (m.writerGeneration !== value) { invalidate(state,m); fail('GENERATION_MISMATCH'); }
    if (m.state !== 'OPEN') fail('CYCLE_NOT_OPEN');
  }
  function checkProjection(state,m) {
    const file=manifestPath(m.cycleId);
    if (!fs.existsSync(file)) return null;
    let projection;
    try {
      projection=JSON.parse(fs.readFileSync(file,'utf8')); validateManifest(projection);
      if (!state.projections.has(canonical(projection))) fail('PROJECTION_MISMATCH');
    } catch { invalidate(state,m); fail('PROJECTION_INVALID'); }
    return projection;
  }
  function withState(fn) {
    return locked(()=>{
      const state=replay();
      for (const m of state.cycles.values()) checkProjection(state,m);
      return fn(state);
    });
  }
  return {
    openCycle({ protocolId,campaignId,cycleId,openedAt,history }) {
      return withState(state=>{
        if (!Array.isArray(history)) fail('HISTORY_REQUIRED_NO_BACKFILL');
        if (state.cycles.has(cycleId) || history.some(r=>r?.cycleId===cycleId || r?.metadata?.context?.monitorCycleId===cycleId)) fail('CYCLE_EXISTS_NO_BACKFILL');
        const writerGeneration=Math.max(0,...[...state.cycles.values()].map(m=>m.writerGeneration))+1;
        const m=newManifest({protocolId,campaignId,cycleId,openedAt,writerGeneration});
        append(state,'CYCLE_OPEN_COMMIT',{protocolId,campaignId,cycleId,openedAt,writerGeneration}); return clone(m);
      });
    },
    beginWriter({cycleId,writerGeneration,writerId}) {
      return withState(state=>{const m=get(state,cycleId); generation(state,m,writerGeneration);
        if (!validId(writerId) || state.writers.get(cycleId).has(writerId) || state.closing.has(cycleId) || state.observationTerminals.get(cycleId)) fail('WRITER_BLOCKED');
        append(state,'WRITER_BEGIN',{cycleId,writerGeneration,writerId}); });
    },
    endWriter({cycleId,writerGeneration,writerId}) {
      return withState(state=>{const m=get(state,cycleId); generation(state,m,writerGeneration);
        if (!state.writers.get(cycleId).has(writerId) || [...state.operations.values()].some(o=>o.payload.cycleId===cycleId && o.payload.writerId===writerId && !o.committed)) fail('WRITER_PENDING');
        append(state,'WRITER_END',{cycleId,writerGeneration,writerId}); });
    },
    beginRecordCreation({cycleId,writerGeneration,writerId,operationId,record}) {
      return withState(state=>{
        const m=get(state,cycleId); generation(state,m,writerGeneration);
        if (!validId(operationId) || !validId(record?.id) || !sameMembership(record,m) || record.settledAt != null || record.outcome != null || record.status==='CLOSED') fail('INVALID_CREATION');
        const payload={cycleId,writerGeneration,writerId,operationId,recordId:record.id,protocolId:m.protocolId,campaignId:m.campaignId,record:clone(record)};
        const old=state.operations.get(operationId);
        if (old) { if (canonical(old.payload)!==canonical(payload)) { invalidate(state,m); fail('INCOMPATIBLE_DUPLICATE'); } return; }
        if ([...state.operations.values()].some(o=>o.payload.recordId===record.id)) { invalidate(state,m); fail('INCOMPATIBLE_DUPLICATE'); }
        if (!state.writers.get(cycleId).has(writerId) || state.closing.has(cycleId) || state.observationTerminals.get(cycleId)) fail('WRITER_BLOCKED');
        append(state,'RECORD_CREATE_INTENT',payload);
      });
    },
    readyRecordBatch({cycleId,writerGeneration,writerId,batchId,operationIds}) {
      return withState(state=>{
        const m=get(state,cycleId); generation(state,m,writerGeneration);
        if (!validId(batchId) || !Array.isArray(operationIds) || !operationIds.length) fail('INVALID_BATCH');
        append(state,'RECORD_BATCH_READY',{cycleId,writerGeneration,writerId,batchId,operationIds});
      });
    },
    commitRecordCreation({cycleId,writerGeneration,operationId}) {
      return withState(state=>{
        const m=get(state,cycleId); generation(state,m,writerGeneration);
        const op=state.operations.get(operationId); if (!op || op.payload.cycleId!==cycleId) fail('INTENT_REQUIRED');
        if (!op.committed) append(state,'RECORD_CREATE_COMMIT',{cycleId,writerGeneration,operationId,recordId:op.payload.recordId,protocolId:m.protocolId,campaignId:m.campaignId});
        return clone(op.payload.record);
      });
    },
    commitObservationTerminal({cycleId,writerGeneration,outcome,reasonCode=null}) {
      return withState(state=>{
        const m=get(state,cycleId); generation(state,m,writerGeneration);
        if (state.observationTerminals.get(cycleId)) fail('OBSERVATION_TERMINAL_EXISTS');
        if (state.writers.get(cycleId).size || [...state.operations.values()].some(o=>o.payload.cycleId===cycleId&&!o.committed)) fail('OBSERVATION_TERMINAL_PENDING');
        append(state,'CYCLE_OBSERVATION_COMMIT',{cycleId,writerGeneration,outcome,reasonCode});
        return clone(state.observationTerminals.get(cycleId));
      });
    },
    sealCycle({cycleId,writerGeneration,sealedAt}) {
      return withState(state=>{
        const m=get(state,cycleId); generation(state,m,writerGeneration);
        if (!validTime(sealedAt) || Date.parse(sealedAt)<Date.parse(m.openedAt)) fail('INVALID_SEAL_TIME');
        if (observationTerminalRequired && !state.observationTerminals.get(cycleId)) fail('OBSERVATION_TERMINAL_REQUIRED');
        if (!state.closing.has(cycleId)) append(state,'CYCLE_SEAL_BEGIN',{cycleId,writerGeneration});
        if (state.writers.get(cycleId).size || [...state.operations.values()].some(o=>o.payload.cycleId===cycleId&&!o.committed)) fail('SEAL_PENDING');
        validateManifest(m); append(state,'CYCLE_SEAL_COMMIT',{cycleId,writerGeneration,sealedAt,canonicalDigest:m.canonicalDigest}); return clone(m);
      });
    },
    invalidateCycle({cycleId}) { return withState(state=>{const m=get(state,cycleId); invalidate(state,m); return clone(m);}); },
    readManifest(cycleId) {
      return withState(state=>{
        const m=get(state,cycleId), projection=checkProjection(state,m);
        if (!projection || canonical(projection)!==canonical(m)) fail('PROJECTION_REQUIRES_RECOVERY');
        return clone(m);
      });
    },
    recoveryBatches({history}) {
      return withState(state=>{
        if (!Array.isArray(history)) fail('HISTORY_REQUIRED');
        const batches=[];
        for (const {payload} of state.batches.values()) {
          const m=get(state,payload.cycleId);
          if (m.state!=='OPEN') continue;
          const operations=payload.operationIds.map(id=>state.operations.get(id));
          const records=operations.map(op=>clone(op.payload.record));
          const present=records.map(record=>history.filter(row=>row?.id===record.id));
          if (present.some(rows=>rows.length>1) || present.some((rows,i)=>rows.length && !operations[i].committed && canonical(rows[0])!==canonical(records[i])) ||
              present.some((rows,i)=>!rows.length && history.some(row=>records[i].decisionId && row?.decisionId===records[i].decisionId))) fail('HISTORY_IDENTITY_CONFLICT');
          if (present.some(rows=>rows.length) && present.some(rows=>!rows.length)) fail('HISTORY_BATCH_PARTIAL');
          batches.push({cycleId:payload.cycleId,writerGeneration:payload.writerGeneration,
            operationIds:[...payload.operationIds],records,materialized:present.every(rows=>rows.length===1),
            committed:operations.map(op=>op.committed)});
        }
        return batches;
      });
    },
    recover({history}) {
      return withState(state=>{
        if (!Array.isArray(history)) fail('HISTORY_REQUIRED');
        const records=structuredClone(history), materializedRecordIds=[];
        for (const m of state.cycles.values()) checkProjection(state,m);
        for (const op of state.operations.values()) {
          if (!op.committed) continue;
          const m=get(state,op.payload.cycleId); if (m.state==='INVALID') continue;
          const existing=records.filter(r=>r?.id===op.payload.recordId);
          if (existing.length>1 || existing.some(r=>!sameMembership(r,m) ||
            ['decisionId','asset','direction'].some(key=>r[key]!==op.payload.record[key]) ||
            (r.status==='OPEN' && r.outcome==null && canonical(r)!==canonical(op.payload.record)))) {
            invalidate(state,m); fail('HISTORY_IDENTITY_CONFLICT');
          }
          if (!existing.length) { records.push(clone(op.payload.record)); materializedRecordIds.push(op.payload.recordId); }
        }
        for (const m of state.cycles.values()) {
          if (m.state!=='INVALID') {
            const verification=verifyManifestAgainstHistory(m,records);
            if (verification.reasons.some(reason=>['EXTRA_RECORD','DUPLICATE_RECORD','MEMBERSHIP_MISMATCH'].includes(reason))) {
              invalidate(state,m); fail('HISTORY_INVENTORY_CONFLICT');
            }
          }
          project(manifestPath(m.cycleId),m);
        }
        // A future integration may materialize scheduler termination ONLY from these seal commits.
        const sealedCycleIds=[...state.cycles.values()].filter(m=>m.state==='SEALED').map(m=>m.cycleId);
        const unresolvedCycleIds=[...state.cycles.values()].filter(m=>m.state!=='SEALED').map(m=>m.cycleId);
        const observationTerminals=Object.fromEntries([...state.observationTerminals].filter(([,v])=>v).map(([k,v])=>[k,clone(v)]));
        return {records,materializedRecordIds,sealedCycleIds,unresolvedCycleIds,observationTerminals};
      });
    },
    verifyManifestAgainstHistory
  };
}
