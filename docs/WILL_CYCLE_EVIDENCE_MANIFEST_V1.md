# Cycle Evidence Manifest v1 + WAL v1 — offline foundation

No runtime integration, no collection start, no new freeze. Existing historyStore, autonomousPaperMonitor, dashboard, evaluator and strategy are untouched. Only callers explicitly constructing a journal in an absolute directory create files. Tests use temporary directories and synthetic records.

## Authority and membership

The append-only hash-chained WAL is authority for creation/membership, inventory and seal only. Projection manifests contain the allowlisted v1 fields and no performance. The canonical SHA256 covers schemaVersion, protocolId, campaignId, cycleId, writerGeneration, expectedRecordCount and sorted recordIds, with recursively sorted JSON object keys and finite JSON values. Settlements never enter the digest.

Future records must carry immutable protocolId/campaignId/cycleId/writerGeneration independently of a manifest's validity. The foundation validates these at intent and recovery; enforcing them in every real mutation path is a future integration obligation. IDs must be pre-generated. Initial creation payloads must not already carry settlement results. WAL creation payloads are private operational recovery data, not a public manifest/report.

openCycle requires full history as an anti-backfill check. A new journal generation is allocated monotonically; retain its entire journal directory. Never recreate an empty journal to reset generations or retrofit an old cycle. Unrelated existing records are not assigned membership. No actual OOS-2R campaign or prospective start is selected here.

## Lifecycle and writers

OPEN is fsynced before a writer or creation intent can be registered. Explicit beginWriter/endWriter events track overlapping writers. beginRecordCreation durably records intent, pre-generated record ID, operation ID and membership. commitRecordCreation durably confirms creation and increments count/revision once. The returned creation is only materialized after that commit. Identical intent/commit retries while OPEN are idempotent; incompatible duplicates invalidate the cycle.

sealCycle first durably closes new-writer/new-intent admission. It returns SEAL_PENDING until active writers and pending transactions drain; callers retry explicitly, no background loop. Existing intents can commit and writers can end during draining. A durable CYCLE_SEAL_COMMIT precedes SEALED projection. New creation after seal is rejected. Settlement of an existing record does not change inventory.

INVALID never reopens. Generation mismatch, incompatible duplicate or conflicting existing membership invalidate the cycle. Unreadable/corrupt/sequencing-invalid WAL quarantines the entire journal using an INVALID marker, rejects all reads/mutations and retains original WAL bytes; it does not fabricate a per-cycle manifest from untrusted data.

## Recovery and crash boundaries

Each event has version, sequence, previousHash and SHA256. Replay validates the chain AND transition semantics. Unterminated/truncated tails are conservatively quarantined, not guessed or trimmed. A crash before a creation commit cannot materialize the intent. A crash after commit can materialize its missing initial record. Projection failure after commit is recoverable from the WAL.

recover takes a supplied complete history snapshot and returns a new records array, materialized IDs and completedCycleIds derived ONLY from seal commits. It never writes history or scheduler state. Existing matching records are preserved including later settlements; duplicate IDs or changed membership block recovery. Repeating recovery with its returned history does not duplicate creation. A future integration must apply missing insertions transactionally and restore scheduler termination from confirmed seal evidence only.

Writers/intents remain durably active after crash: their absence in process memory does not permit seal. Resume only with validated ownership or invalidate; there is no automatic abandonment or timeout. Real process death may leave writer.lock. This version fails closed until an operator proves no live owner and performs a separately authorized recovery procedure; no stale-lock stealing is implemented.

## Persistence and Windows limitations

Operations serialize through an exclusive wx lock. WAL and temporary projection files use explicit fsync; projections use rename within the same directory. Concurrent callers may receive JOURNAL_LOCKED and must not bypass it. Filesystem/antivirus sharing restrictions may prevent rename; the WAL remains authority.

These measures and injected exceptions test process-crash boundaries, NOT proven power-loss safety. Node/Windows directory-entry durability, filesystem guarantees and drive write caches are not established by these tests. No claim of power-loss protection, authenticated tamper resistance or multi-host safety is made. Hashes detect accidental corruption but are not signatures. Disk-full or uncertain appends quarantine rather than continuing blindly.

## Acceptance and future integration

verifyManifestAgainstHistory checks full cycle membership independent of statistical eligibility: exact IDs, duplicates, generation, digest, SEALED state and terminal settlement timestamps. Pending records block completeness without changing inventory. Monitor completion remains an additional future runtime requirement.

No old-cycle backfill, inventory reconstruction from history, threshold tuning or performance computation. This foundation does not authorize OOS-2R, runtime restart, broker execution or a new freeze. Real writer integration, atomic insertion into history, authenticated ownership/recovery and campaign-boundary selection require separate review.
