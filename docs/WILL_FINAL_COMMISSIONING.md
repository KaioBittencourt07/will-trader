# WILL final commissioning H1 — PAPER execution reliability

This is prospective operational telemetry only. It does not alter Champion, trading strategy, admission, direction, confidence, ranking, the 30,000 ms temporal-reference deadline, outcomes, or retired OOS evidence. It cannot execute broker orders or promote to LIVE. Do not point it at or repair a retired OOS-2V history/evidence directory. The cause of old zero-record cycle `autonomous-paper-monitor-v1:29836663` is **not** reconstructed.

## Activation and schema

Use a reviewed PAPER environment with a fresh private `WILL_FINAL_COMMISSIONING_STATE_FILE` and set `WILL_FINAL_COMMISSIONING_ENABLED=true`. Leave the flag off for legacy behavior. Start only after operator approval for the soak; this commit does not start a backend, feed, monitor or collection. On first startup the telemetry store snapshots existing history IDs as baseline, so only future monitor records can enter commissioning. On restart it loads the same private state and reconciles post-baseline records from history; no historical outcome is reclassified. Invalid state fails startup closed. An I/O error after startup exposes `DEGRADED` on `/api/commissioning`, without changing a PAPER settlement.

The private, atomically replaced `paper-final-commissioning-v1` state contains only baseline IDs, sanitized per-entry projections and optional cycle summaries. Per planned entry: `decisionId`, `monitorCycleId`, asset, direction, provider/source, planned click, first PAPER-confirmed temporal reference time, observed entry lag/found/miss reason, fixed `entryReferenceDeadlineMs=30000`, expiry target, exit reference time/lag/found, initial quote age, allowlisted provider-health label and sanitized settlement state (`PENDING`, `SETTLED`, `DATA_INVALID`). No price, frame, token, URL or raw provider error is written. The first valid entry reference comes only from `execution.status=PAPER_CONFIRMED` and its actual PAPER click timestamp; exit reference comes only from a persisted official temporal settlement. A missing reference remains `DATA_INVALID` under the existing settlement code. `expiryAt` determines expiry target from actual PAPER click when present; no time is synthesized.

**P0 baseline settlement isolation:** when commissioning is enabled, the settlement admission predicate requires an ID absent from the private activation baseline, a monitor cycle ID of the expected form, `createdAt` strictly later than the persisted activation time, and no OOS-2 protocol identity. This predicate is AND-composed with existing evidence admission. The underlying PAPER entry/expiry settlement semantics are unchanged. In particular, the legacy monitor-prefix scope no longer makes old baseline OPEN or PAPER_CONFIRMED records mutable in commissioning mode. The four old rows affected by the initial soak incident are **not** repaired or reclassified by this change.

Success-cycle summaries are written to the durable monitor state **before** evidence seal and become visible only after the cycle ID is durably completed. Counts use allowlisted reasons: `NO_SIGNAL`, `DEDUPLICATED`, `PROVIDER_UNAVAILABLE`, `PROVIDER_COOLDOWN`, `STALE_DATA`, `MARKET_DATA_INVALID`, `ADMISSION_REJECTED`, `WAIT_DECISION`, `NO_EXECUTABLE_CANDIDATE`, `OTHER_SANITIZED_REASON`. This is coarse operational attribution, not a counterfactual explanation of a trade. If the provider returns no study and no reason, the prospective label is `NO_SIGNAL`; it is never applied retrospectively to OOS-2V. In a crash after summary persistence but before seal, the summary is hidden until evidence recovery confirms the seal. Missing summary in opt-in mode prevents a successful evidence seal. Monitor state and telemetry are distinct from WAL/history authority.

Unavailable attribution uses the actual structured `/api/opportunities` `error`, `reason`, `reasons`, `duplicate`, and admission freshness check. Specific nested reasons take precedence over a generic `MARKET_ADMISSION_REJECTED` or `CANONICAL_SNAPSHOT_REJECTED` wrapper; a failed freshness check is `STALE_DATA`, missing/not-ready temporal feed is `PROVIDER_UNAVAILABLE`, HTTP 429/cooldown is `PROVIDER_COOLDOWN`, malformed/insufficient closed bars are `MARKET_DATA_INVALID`, and a duplicate canonical study is `DEDUPLICATED`. Unknown or unsafe free text collapses to `OTHER_SANITIZED_REASON`. Only enum counts persist—never raw provider text, URLs, headers, credentials or payloads.

`GET /api/commissioning` is read-only and returns aggregate health only: PAPER_ONLY, broker execution false, booleans for provider readiness, entry/expiry reference coverage, median/p95/max lag for observed references, reference-window misses, zero-record and skipped-reason counts, DATA_INVALID reasons, monitor/settlement/evidence health and last completed/failure status. It does not expose raw per-entry records, prices, credentials, outcomes, WR, score or recommendations. Until opt-in it returns `503 UNAVAILABLE`; telemetry persistence failure returns `503 DEGRADED` with an allowlisted code. The endpoint itself never synchronizes or writes state. The existing settlement pass and monitor event perform reconciliation.

Example (illustrative shape, **not** a measured soak result):

```json
{
  "ok": true,
  "schemaVersion": "paper-final-commissioning-v1",
  "mode": "PAPER_ONLY",
  "automatedBrokerExecution": false,
  "state": "OBSERVING",
  "providerStatus": {"twelveWebSocket":{"enabled":false,"connected":false}},
  "temporalEntryCoverage": {"planned":0,"found":0,"missed":0,"pending":0},
  "temporalExpiryCoverage": {"eligible":0,"found":0,"missed":0},
  "entryReferenceLagMs": {"median":null,"p95":null,"max":null},
  "expiryReferenceLagMs": {"median":null,"p95":null,"max":null},
  "referenceWindowMisses": {},
  "zeroRecordCyclesByReason": {"NO_SIGNAL":0},
  "skippedRecordsByReason": {"WAIT_DECISION":0},
  "dataInvalidByReason": {},
  "providerErrors": 0,
  "rateLimitCooldowns": 0,
  "monitorState": "UNKNOWN",
  "settlementPending": 0,
  "evidenceRuntimeHealth": null,
  "lastSuccessfulCompleteCycle": null,
  "lastFailureReason": null
}
```

## Pre-registered multi-hour PAPER soak procedure — do not execute in this implementation mission

1. Before enabling: obtain an explicit operator authorization, freeze the exact configuration/time window, asset universe, feed credentials location (not values), monitor cadence, observation target, evidence directory if used, and stop/restart policy. Verify PAPER-only mode, no broker authority, no retired-campaign activation and an empty private commissioning state path. Record the code SHA and clock synchronization status. Do **not** derive any numeric target from OOS-2V WR.
2. Pre-register a wall-clock window of **at least four hours** across more than one market condition. This is an operational commissioning requirement, not a trading-performance threshold. Continue to the pre-set end regardless of good/bad interim metrics, unless a safety stop (secret exposure, unintended LIVE/broker access, history/evidence integrity failure) occurs. Do not count cycles after a safety stop as completed.
3. Capture initial `/api/commissioning`, `/api/paper-monitor` and provider health. Start the explicitly authorized PAPER monitor with the new private telemetry file. Observe status at a fixed cadence (for example every 15 minutes) without changing strategy, thresholds, asset selection or provider budgets. Never print raw keys, prices or frames in the report.
4. At the pre-set end, stop the monitor gracefully; allow only the already-existing bounded settlement process to resolve due PAPER entries. Record pending settlements separately; do not invent an exit or reclassify missing references. Reconcile counts with sanitized private ledger, monitor state, history IDs and evidence health. Verify no duplicates and no unauthorized order/broker activity. Preserve source files for independent audit.
5. Publish only aggregate counts and operational lag distributions. Report every planned entry in the denominator, including DATA_INVALID/missing references. Compare against **pre-registered operational service requirements** chosen from provider/commissioning constraints, not from OOS-2V performance. This document does not silently set a pass bar for WR, financial edge or LIVE readiness.

Required report fields, even when zero: total cycles; planned entries; entry references found/missed/pending; expiry references found/missed/pending; entry and expiry lag median/p95/max; provider errors; HTTP 429/cooldowns; zero-record cycles by reason; SKIPPED by reason; DATA_INVALID by reason; crashes/restarts; duplicate records/decisions; unresolved settlements. Distinguish zero-record SUCCESS from operational failure. Document downtime and missing telemetry as failures of observation, not as zero incidents. A status endpoint snapshot alone is not a complete soak report.

## Known limitations / blockers before claiming commissioning success

- No real multi-hour soak has been run in this mission; provider/network behavior, rates and lag distributions remain unknown.
- The zero-record reason taxonomy is deliberately coarse and reports what the response exposed. It cannot reconstruct a missing request trace or prove why an old cycle had zero records.
- The telemetry file and monitor state are separate authorities. WAL/history remains authoritative for records; a telemetry persistence failure must be surfaced as degraded and resolved before declaring a soak successful. A crash before history persistence creates no planned entry, while a crash after history persistence can be reconciled on restart.
- The summary identifies `SKIPPED` via the current scanner `releaseEligible` stage; individual reason mapping is sanitized and may collapse to `OTHER_SANITIZED_REASON`. It is not a complete causal explanation of every WAIT.
- There is no frozen payout, fees/slippage or LIVE execution model. Operational reliability is not strategy edge or automatic deployment permission.
