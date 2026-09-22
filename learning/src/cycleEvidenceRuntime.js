import { randomUUID, randomBytes } from 'node:crypto';
import { createCycleEvidenceJournal } from './cycleEvidenceJournal.js';
import { MEMBERSHIP_FIELDS, validId } from './cycleEvidenceManifest.js';

// No defaults for campaign/protocol: enabling without explicit configuration fails closed.
export function createCycleEvidenceRuntime({ directory, protocolId, campaignId, historyStore,
  journal = null, now = () => new Date().toISOString(), fault = () => {}, capabilityNow = () => performance.now(), observationTerminalRequired = false, maxCandidateCycles = null } = {}) {
  if (!validId(protocolId) || !validId(campaignId) || !historyStore?.prepareDecisionRecord || !historyStore?.insertPreparedRecord) {
    throw new Error('EVIDENCE_CONFIGURATION_REQUIRED');
  }
  const wal = journal ?? createCycleEvidenceJournal({ directory,observationTerminalRequired });
  if (maxCandidateCycles !== null && (!Number.isInteger(maxCandidateCycles) || maxCandidateCycles < 1)) throw new Error('EVIDENCE_CANDIDATE_LIMIT_INVALID');
  const active = new Set(), known = new Set(), writers = new Map();
  const capabilities = new Map();
  const revoke = cycleId => { for (const [token,value] of capabilities) if (value.cycleId === cycleId) capabilities.delete(token); };
  let ready = false, paused = false;
  const pause = () => { paused = true; capabilities.clear(); };
  function guard() { if (!ready || paused) throw new Error('EVIDENCE_PAUSED'); }
  function durable(fn) {
    try { return fn(); } catch { pause(); throw new Error('EVIDENCE_STORAGE_FAILURE'); }
  }
  function membership(cycleId) {
    guard();
    const manifest = wal.readManifest(cycleId);
    if (!active.has(cycleId) || manifest.state !== 'OPEN' || manifest.protocolId !== protocolId || manifest.campaignId !== campaignId) {
      throw new Error('EVIDENCE_CYCLE_NOT_ACTIVE');
    }
    return Object.freeze(Object.fromEntries(MEMBERSHIP_FIELDS.map(key => [key,manifest[key]])));
  }
  return {
    pause,
    health: () => ({ ready, paused, observationTerminalRequired, candidateCyclesObserved:known.size, candidateCycleLimit:maxCandidateCycles, collectionClosed:maxCandidateCycles!==null&&known.size>=maxCandidateCycles, newCandidateAdmissionAllowed:ready&&!paused&&(maxCandidateCycles===null||known.size<maxCandidateCycles) }),
    issueRequestCapability(cycleId) {
      return durable(() => {
        membership(cycleId);
        const issuedAt=capabilityNow();
        if (!Number.isFinite(issuedAt)) throw new Error('CAPABILITY_CLOCK_INVALID');
        revoke(cycleId);
        const token=randomBytes(32).toString('hex');
        capabilities.set(token,{cycleId,issuedAt,expiresAt:issuedAt+30_000});
        return token;
      });
    },
    consumeRequestCapability(cycleId,token) {
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return false;
      const grant=capabilities.get(token); capabilities.delete(token);
      const at=capabilityNow();
      if (!ready || paused || !grant || grant.cycleId !== cycleId || !Number.isFinite(at) || at<grant.issuedAt || at>=grant.expiresAt) return false;
      try { return Boolean(membership(cycleId)); } catch { pause(); return false; }
    },
    recover() {
      return durable(() => {
        if (active.size || writers.size) throw new Error('ACTIVE_RECOVERY_FORBIDDEN');
        // Only a durable READY batch authorizes replay of its immutable WAL intents.
        // The history write is atomic for the whole batch; a partial batch is corrupt.
        for (const batch of wal.recoveryBatches({history:historyStore.list()})) {
          if (!batch.materialized) historyStore.insertPreparedRecords(batch.records);
          for (const operationId of batch.operationIds) {
            wal.commitRecordCreation({cycleId:batch.cycleId,writerGeneration:batch.writerGeneration,operationId});
          }
        }
        const recovery = wal.recover({ history: historyStore.list() });
        for (const id of [...recovery.sealedCycleIds,...recovery.unresolvedCycleIds]) known.add(id);
        // Legacy WALs predating READY may have COMMIT before history. Reconcile
        // only their immutable durable intents; never synthesize an observation.
        for (const id of recovery.materializedRecordIds) {
          historyStore.insertPreparedRecord(recovery.records.find(r => r.id === id));
        }
        // OPEN/INVALID after restart requires operator recovery, never inferred closure.
        if (recovery.unresolvedCycleIds.length) throw new Error('UNRESOLVED_CYCLE');
        ready = true; paused = false;
        return { sealedCycleIds: [...recovery.sealedCycleIds] };
      });
    },
    openMonitorCycle(cycleId) {
      guard();
      if (maxCandidateCycles !== null && known.size >= maxCandidateCycles) throw new Error('EVIDENCE_CANDIDATE_LIMIT_REACHED');
      return durable(() => {
        const m = wal.openCycle({ protocolId,campaignId,cycleId,openedAt:now(),history:historyStore.list() });
        active.add(cycleId); known.add(cycleId); return m;
      });
    },
    membershipForCycle(cycleId) {
      // Never let a late request for a sealed/invalid evidence cycle fall back to legacy persistence.
      if (known.has(cycleId) && !active.has(cycleId)) throw new Error('EVIDENCE_CYCLE_CLOSED');
      if (!active.has(cycleId)) return null;
      return durable(() => membership(cycleId));
    },
    beginCycleWriter(cycleId) {
      return durable(() => {
        const m = membership(cycleId), writerId=randomUUID();
        wal.beginWriter({ ...m,writerId });
        const token=Object.freeze({ writerId }); writers.set(token,{ ...m,writerId,staged:[] }); return token;
      });
    },
    stageRecord(token,input) {
      guard(); const ctx=writers.get(token); if(!ctx)throw new Error('WRITER_REQUIRED');
      const m=membership(ctx.cycleId),prepared=JSON.parse(JSON.stringify(historyStore.prepareDecisionRecord({ ...input,
        context:{ ...input.context,monitorCycleId:m.cycleId } },m)));
      ctx.staged.push(prepared);return structuredClone(prepared);
    },
    abortStagedRecords(token) {
      const ctx=writers.get(token);if(!ctx)throw new Error('WRITER_REQUIRED');ctx.staged.length=0;
    },
    commitStagedRecords(token) {
      return durable(()=>{
        guard();const ctx=writers.get(token);if(!ctx)throw new Error('WRITER_REQUIRED');
        const prepared=ctx.staged.map(record=>structuredClone(record)),operations=[];
        for(const record of prepared){const operationId=randomUUID();fault('BEFORE_INTENT');wal.beginRecordCreation({...ctx,operationId,record});fault('AFTER_INTENT');operations.push({operationId,record});}
        if (operations.length) wal.readyRecordBatch({...ctx,batchId:randomUUID(),operationIds:operations.map(o=>o.operationId)});
        fault('AFTER_READY');
        let result;
        if(typeof historyStore.insertPreparedRecords==='function')result=historyStore.insertPreparedRecords(prepared);
        else if(prepared.length<=1)result=prepared.map(record=>historyStore.insertPreparedRecord(record));
        else throw new Error('EVIDENCE_BATCH_STORE_REQUIRED');
        fault('AFTER_INSERT');
        for(const {operationId} of operations){wal.commitRecordCreation({...ctx,operationId});fault('AFTER_COMMIT');}
        ctx.staged.length=0;return result;
      });
    },
    commitRecord(token,input) {
      return durable(() => {
        guard(); const ctx=writers.get(token); if (!ctx) throw new Error('WRITER_REQUIRED');
        const m=membership(ctx.cycleId);
        const prepared=JSON.parse(JSON.stringify(historyStore.prepareDecisionRecord({ ...input,
          context:{ ...input.context,monitorCycleId:m.cycleId } },m)));
        const operationId=randomUUID();
        fault('BEFORE_INTENT');
        wal.beginRecordCreation({ ...ctx,operationId,record:prepared });
        fault('AFTER_INTENT');
        wal.readyRecordBatch({...ctx,batchId:randomUUID(),operationIds:[operationId]});
        fault('AFTER_READY');
        const record=historyStore.insertPreparedRecord(prepared);
        fault('AFTER_INSERT');
        wal.commitRecordCreation({ ...ctx,operationId });
        fault('AFTER_COMMIT'); return record;
      });
    },
    endCycleWriter(token) {
      return durable(() => {
        const ctx=writers.get(token); if (!ctx) throw new Error('WRITER_REQUIRED');
        if(ctx.staged.length)throw new Error('WRITER_STAGED_RECORDS_PENDING');
        wal.endWriter(ctx); writers.delete(token);
      });
    },
    commitObservationTerminal(cycleId,{outcome,reasonCode=null}={}) {
      return durable(() => {
        revoke(cycleId); const m=membership(cycleId);
        return wal.commitObservationTerminal({...m,outcome,reasonCode});
      });
    },
    sealMonitorCycle(cycleId) {
      return durable(() => {
        revoke(cycleId);
        const m=membership(cycleId);
        const sealed=wal.sealCycle({ ...m,sealedAt:now() });
        active.delete(cycleId); return sealed;
      });
    },
    invalidateMonitorCycle(cycleId) {
      return durable(() => {
        revoke(cycleId);
        guard();
        if (!active.has(cycleId) || [...writers.values()].some(w=>w.cycleId===cycleId)) throw new Error('ACTIVE_WRITER');
        const invalid=wal.invalidateCycle({cycleId}); active.delete(cycleId); return invalid;
      });
    }
  };
}
