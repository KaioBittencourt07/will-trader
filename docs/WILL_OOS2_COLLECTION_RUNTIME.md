# Conservative collection endpoint

GET /api/oos2/collection-status reads the complete app.locals.historyStore.list() snapshot and the durable monitor state without writing or repairing either. State path follows WILL_PAPER_MONITOR_STATE_FILE, otherwise data/will-paper-monitor-state.json relative to the runtime working directory, just like the scheduler. No background task or provider access is started by this route.

"Durable monitor completion proves scheduler termination, not completeness of the set of records created for the cycle."

Valid version and string cycle IDs yield DEGRADED, not PASS. Missing, unreadable or invalid state yields UNAVAILABLE. Both return zero verified completed IDs. Settlements, absence of pending records, or counts of records found cannot establish completeness. Unknown additional state fields cannot enable PASS.

The response contains collection/integrity only; completedCandidateCycles stays 0 and formalAnalysisAllowed stays false. HTTP 200/ok means the read succeeded, not readiness. Failure to read history produces HTTP 503/ok=false with unavailable completeness and conservative empty progress; those zeros are not evidence of empty real history. Responses are no-store. No raw error or record is logged or returned.

## Future inventory design — proposal only, NOT implemented

Use a separately versioned per-cycle inventory with durable record IDs, count, canonical digest, writer generation and an explicit sealed marker. Record creation and inventory registration must be atomic (transaction or recoverable write-ahead journal); a final marker alone cannot prove no record was lost. Seal only after all cycle writers finish; failures/crashes remain unsealed until verified recovery. No post-seal additions without a new invalidating generation.

A future reader would verify the seal, unique inventory IDs, count/digest, exact membership against the complete history, monitor completion and a terminal settlement state for every relevant PAPER record. Missing/extra/duplicate/pending records or mismatched generation would block completeness. Store no performance aggregates. Existing cycles cannot be backfilled by assuming the currently visible records are exhaustive. This requires separate authorization and migration/recovery tests before PASS can exist.
