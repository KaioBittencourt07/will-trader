import { randomUUID, randomBytes } from 'node:crypto';
import { createCycleEvidenceJournal } from './cycleEvidenceJournal.js';
import { MEMBERSHIP_FIELDS, validId } from './cycleEvidenceManifest.js';

// No defaults for campaign/protocol: enabling without explicit configuration fails closed.
export function createCycleEvidenceRuntime({ directory, protocolId, campaignId, historyStore,
  journal = null, now = () => new Date().toISOString(), fault = () => {}, capabilityNow = () => performance.now(), observationTerminalRequired = false, maxCandidateCycles = null,
  recoverInterruptedOpenCycles = false } = {}) {
  if (!validId(protocolId) || !validId(campaignId) || !historyStore?.prepareDecisionRecord || !historyStore?.insertPreparedRecord) {
    throw new Error('EVIDENCE_CONFIGURATION_REQUIRED');
  }
  const wal = journal ?? createCycleEvidenceJournal({ directory,observationTerminalRequired });
  if (maxCandidateCycles !== null && (!Number.isInteger(maxCandidateCycles) || maxCandidateCycles < 1)) throw new Error('EVIDENCE_CANDIDATE_LIMIT_INVALID');
  const active = new Set(), known = new Set(), writers = new Map();
  const capabilities = new Map();
  const revoke = cycleId => { for (const [token,value] of capabilities) if (value.cycleId === cycleId) capabilities.delete(token); };
  let ready = false, paused = false;
  const recoveryInterrupted=new Set();
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
    isPaperSettlementAllowed(record) {
      if(record?.protocolId!==protocolId||record?.campaignId!==campaignId)return true;
      return ready&&!paused&&!recoveryInterrupted.has(record.cycleId);
    },
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
        // Recovery never publishes an uncommitted record. READY permits a
        // private projection; WAL commits make it authoritative before publish.
        for (const batch of wal.recoveryBatches({history:historyStore.list()})) {
          if(!historyStore.prepareEvidenceBatch||!historyStore.publishEvidenceBatch)throw new Error('EVIDENCE_TRANSACTION_STORE_REQUIRED');
          const projection=batch.materialized?null:historyStore.prepareEvidenceBatch(batch.records);
          for (const operationId of batch.operationIds) {
            wal.commitRecordCreation({cycleId:batch.cycleId,writerGeneration:batch.writerGeneration,operationId});
          }
          if(projection)historyStore.publishEvidenceBatch(projection);
        }
        let recovery = wal.recover({ history: historyStore.list() });
        for (const id of [...recovery.sealedCycleIds,...recovery.unresolvedCycleIds]) known.add(id);
        // Legacy WALs predating READY may have COMMIT before history. Reconcile
        // only their immutable durable intents; never synthesize an observation.
        for (const id of recovery.materializedRecordIds) {
          historyStore.insertPreparedRecord(recovery.records.find(r => r.id === id));
        }
        if(recoverInterruptedOpenCycles){
          for(const id of recovery.unresolvedCycleIds){
            wal.recoverInterruptedCycle({cycleId:id,sealedAt:now(),history:historyStore.list()});
          }
          recovery=wal.recover({history:historyStore.list()});
        }
        for(const [id,terminal] of Object.entries(recovery.observationTerminals)){
          if(terminal.outcome==='RECOVERY_INTERRUPTED')recoveryInterrupted.add(id);
        }
        // Default remains fail-closed for retired/legacy campaigns.
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
        if(prepared.length&&(!historyStore.prepareEvidenceBatch||!historyStore.publishEvidenceBatch))throw new Error('EVIDENCE_TRANSACTION_STORE_REQUIRED');
        for(const record of prepared){const operationId=randomUUID();fault('BEFORE_INTENT');wal.beginRecordCreation({...ctx,operationId,record});fault('AFTER_INTENT');operations.push({operationId,record});}
        if (operations.length) wal.readyRecordBatch({...ctx,batchId:randomUUID(),operationIds:operations.map(o=>o.operationId)});
        fault('AFTER_READY');
        if(!operations.length){ctx.staged.length=0;return [];}
        const projection=historyStore.prepareEvidenceBatch(prepared);
        fault('AFTER_PREPARE');
        for(const {operationId} of operations){wal.commitRecordCreation({...ctx,operationId});fault('AFTER_COMMIT');}
        const result=historyStore.publishEvidenceBatch(projection);
        fault('AFTER_INSERT');ctx.staged.length=0;return result.filter(r=>prepared.some(p=>p.id===r.id));
      });
    },
    commitRecord(token,input) {
      return durable(() => {
        guard(); const ctx=writers.get(token); if (!ctx) throw new Error('WRITER_REQUIRED');
        if(!historyStore.prepareEvidenceBatch||!historyStore.publishEvidenceBatch)throw new Error('EVIDENCE_TRANSACTION_STORE_REQUIRED');
        const m=membership(ctx.cycleId);
        const prepared=JSON.parse(JSON.stringify(historyStore.prepareDecisionRecord({ ...input,
          context:{ ...input.context,monitorCycleId:m.cycleId } },m)));
        const operationId=randomUUID();
        fault('BEFORE_INTENT');
        wal.beginRecordCreation({ ...ctx,operationId,record:prepared });
        fault('AFTER_INTENT');
        wal.readyRecordBatch({...ctx,batchId:randomUUID(),operationIds:[operationId]});
        fault('AFTER_READY');
        const projection=historyStore.prepareEvidenceBatch([prepared]);
        fault('AFTER_PREPARE');
        wal.commitRecordCreation({ ...ctx,operationId });
        fault('AFTER_COMMIT');
        historyStore.publishEvidenceBatch(projection);
        fault('AFTER_INSERT'); return prepared;
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
