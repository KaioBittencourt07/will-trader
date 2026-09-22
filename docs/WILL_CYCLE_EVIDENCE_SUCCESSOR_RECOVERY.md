# Cycle evidence successor transaction and recovery (pre-freeze)

This generic mechanism creates no OOS-2V protocol, campaign, freeze, or real evidence. Retired OOS-2U evidence and history are not migrated or repaired. Interrupted-OPEN recovery is explicitly opt-in (`recoverInterruptedOpenCycles`); the default remains fail-closed.

## Publication authority

1. `RECORD_CREATE_INTENT` durably stores each complete immutable prepared record.
2. `RECORD_BATCH_READY` binds the complete batch. Earlier partial intents are never promoted.
3. The history store writes and fsyncs a private full-file projection. `list()` and the official history path still expose the old snapshot.
4. Every `RECORD_CREATE_COMMIT` becomes durable in the WAL.
5. Only then does an atomic rename publish the prepared projection as official history.

A crash after step 4 is reconciled from the already-durable intents; recovery privately prepares, completes missing commits idempotently, and publishes the exact batch. A crash before READY never materializes its intents. Duplicate IDs, decision-ID conflicts, wrong membership, partial batches, or changed history fail closed. No provider call, market observation, decision, or outcome is generated during recovery.

The private projection may leave an orphan temporary file after a crash. It has no official-history authority. WAL and history remain separate files, so arbitrary simultaneous filesystem rollback or an unprovable stale lock is not claimed to be automatically recoverable.

## Interrupted OPEN terminal

After transaction reconciliation and exact inventory checks, opt-in recovery writes `CYCLE_RECOVERY_TERMINAL` with `RECOVERY_INTERRUPTED / PROCESS_INTERRUPTION`. This event explicitly aborts unready intents and any orphaned writer; it is not `WRITER_END`, `SUCCESS`, or provider `OPERATIONAL_FAILURE`. The original manifest is then sealed. The slot is consumed, `replacementAllowed=false`, and `performanceEligible=false`. A terminal already committed before the crash retains its original identity while recovery finishes the seal. Replaying recovery does not append another terminal or seal.

The generic read-only verifier recognizes a sealed recovery-interrupted slot as structurally valid only when its exact WAL inventory and history membership agree. It never treats that slot as a performance sample. The official server's PAPER settlement admission blocks the current campaign until evidence recovery succeeds and permanently excludes recovery-interrupted cycles. Existing retired-campaign evaluators are not altered or reclassified; a future OOS-2V evaluator must consume this terminal classification explicitly before a freeze is authorized.

## Consumers audited

All fixed-path readers of `historyStore.list()` see only the published snapshot: PAPER settlement, history/learning routes, scanner registry hydration, collection status, baseline/activation audits, and read-only evaluators. Settlement also has a durable-evidence runtime admission check for interrupted-cycle records. No public API exposes the private projection path.
