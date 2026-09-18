# Cycle evidence runtime integration — opt-in, not activated

Base: f8365c7e31e5a34f26d14981898cba33b9993b4a. No real backend/PAPER run, campaign selection, freeze or OOS-2R launch is part of this work.

## Authority and ordering

Monitor -> runtime controller -> opportunities request writer -> prepared history record -> WAL intent -> WAL creation commit -> history insertion. The controller reads authoritative membership from the manifest/WAL, never query protocolId/campaignId/writerGeneration. In-memory state is only an active-context/token registry. Tokens are internal object capabilities, not serialized URL credentials.

The history store exposes prepareDecisionRecord and insertPreparedRecord. Preparation generates the ID but does not persist. Exact duplicate insertion is idempotent; conflicting ID/decisionId is rejected. Insert failure rolls back the in-memory insertion. Existing legacy recordDecision keeps its original deduplication and persistence path when evidence is absent. Membership is top-level and preserved by confirmation/settlement methods.

The request wrapper buffers JSON until finally has ended the writer durably. Exceptions/pending transactions or controller pause yield a sanitized 503. Early responses also close the writer. The monitor opens before runCycle, seals only on explicit ok=true, invalidates operational failures, and persists scheduler termination only afterwards. Storage failures pause without pretending termination. Default evidence-disabled behavior remains unchanged.

## Recovery

Before the first evidence cycle, replay WAL against full history. Insert only materializedRecordIds; existing records, including newer settlements, are untouched. sealedCycleIds can restore scheduler termination but never mean settlement/OOS completeness. Recovery additionally exposes unresolvedCycleIds for OPEN/INVALID cycles: after restoring confirmed missing creations, these block further collection pending explicit operator recovery. No automatic recovery of INVALID scheduler termination is added.

If a creation commits in the WAL but history insertion fails, retain the OPEN cycle, pause and allow recovery to restore the missing creation. Do not INVALID this storage boundary, which would discard its materialization path. If runCycle fails operationally after successful creation and all writers finish, persist INVALID and retain original record membership. A late active writer blocks invalidation/seal rather than being silently abandoned.

## Configuration

WILL_CYCLE_EVIDENCE_ENABLED defaults to false. When true, explicit WILL_CYCLE_EVIDENCE_DIRECTORY (absolute), WILL_CYCLE_EVIDENCE_PROTOCOL_ID and WILL_CYCLE_EVIDENCE_CAMPAIGN_ID are required; none have a real campaign default. Tests use synthetic-protocol/synthetic-campaign only. This patch does not enable any environment flags. Recovery is gated by the PAPER monitor's first authorized run; importing modules does not collect data.

## Limitations / review boundaries

Foundation fsync/Windows, stale lock and rollback limitations still apply. A crash leaving OPEN/INVALID requires operator recovery, not inferred completeness. WAL creation storage and history are separate projections; the commit precedes materialization and recovery is insertion-only. Real filesystem power-loss guarantees are not claimed. Request membership is internally resolved, but existing API authentication/network-access policy is not redesigned here. Legacy non-evidence requests remain legacy. The OOS-2 collection endpoint remains conservative and is not promoted to completeness PASS by this work.

No backfill, old-record membership changes, threshold/operator changes, dashboard, broker or Champion modifications. OOS-2R start/protocol remains a separate authorization.
