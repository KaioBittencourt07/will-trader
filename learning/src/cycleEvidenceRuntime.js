import { randomUUID, randomBytes } from 'node:crypto';
import { createCycleEvidenceJournal } from './cycleEvidenceJournal.js';
import { MEMBERSHIP_FIELDS, validId } from './cycleEvidenceManifest.js';

// No defaults for campaign/protocol: enabling without explicit configuration fails closed.
export function createCycleEvidenceRuntime({ directory, protocolId, campaignId, historyStore,
  journal = null, now = () => new Date().toISOString(), fault = () => {}, capabilityNow = () => performance.now() } = {}) {
  if (!validId(protocolId) || !validId(campaignId) || !historyStore?.prepareDecisionRecord || !historyStore?.insertPreparedRecord) {
    throw new Error('EVIDENCE_CONFIGURATION_REQUIRED');
  }
  const wal = journal ?? createCycleEvidenceJournal({ directory });
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
    health: () => ({ ready, paused }),
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
        const recovery = wal.recover({ history: historyStore.list() });
        for (const id of [...recovery.sealedCycleIds,...recovery.unresolvedCycleIds]) known.add(id);
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
      return durable(() => {
        guard();
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
        const token=Object.freeze({ writerId }); writers.set(token,{ ...m,writerId }); return token;
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
        wal.commitRecordCreation({ ...ctx,operationId });
        fault('AFTER_COMMIT');
        const record=historyStore.insertPreparedRecord(prepared);
        fault('AFTER_INSERT'); return record;
      });
    },
    endCycleWriter(token) {
      return durable(() => {
        const ctx=writers.get(token); if (!ctx) throw new Error('WRITER_REQUIRED');
        wal.endWriter(ctx); writers.delete(token);
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
