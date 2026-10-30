# WILL Edge Gate OOS-2R — frozen prospectively, NOT activated

Protocol: `will-edge-gate-oos2r-v1`. Campaign: `will-edge-gate-oos2r-20260918-v1`.
Edge cut: `2026-09-18T22:49:33.233Z`. Eligibility is strictly `openedAt > edgeCut`.
The cut was selected at the new baseline capture, with backend and monitor stopped as confirmed by the operator, before any activation. No prior timestamp was reused.

Source HEAD: `47913351eb3b391408f20fbebd2feac57f91ce11` (pre-freeze tests on the approved `4e0c1693a3cc4925b44a777ea8a90526503e4628` foundation). The enclosing Git commit identifies the freeze commit; a self-referential commit hash is not embedded in the freeze.

## Immutable artifacts and baseline

- Freeze: `backend/config/experiments/edge-gate-oos2r-freeze.json`.
- Freeze byte SHA256: `f61df0aecdd9336cdd3df52b51dbb32fd74094ed680a85ff4d2490e5ac101892`.
- Public baseline: count 1,095 and hashes only. No raw ID inventory is versioned.
- Baseline IDs SHA256: `d9afa46842648e0fa5deb1fa2cf05717eb0be95eb606ff26eb01acfc502bb08d`.
- Original history file SHA256 at capture: `d5cd273a89a76ebf97dacb88a8b14a13fc8801493c04139d51f312f798128613`.
- Capture: `2026-09-18T22:49:33.233Z`.
- Read-only source: `C:\Users\skdri\will-trader-commissioning\backend\data\will-history.json`.

Only IDs/count and hashes were extracted. No historical outcomes or features were analyzed. The private inventory remains solely in `backend/data/private/oos2r-baseline-ids.json`, excluded by the existing `/backend/data/` Git ignore rule. Never force-add it. Tests use synthetic IDs; the evaluator never opens this file.

Exact reproducible baselineIdsSha256 algorithm:

1. Parse the captured history JSON array (a UTF-8 BOM may be stripped in memory for parsing only).
2. Extract ONLY `record.id`; require nonempty strings of at most 256 UTF-16 code units and unique IDs. Missing, non-string or duplicate IDs fail closed; never deduplicate silently.
3. Sort a copy with JavaScript `Array.prototype.sort()` without comparator: ascending lexicographic UTF-16 code-unit order, case-sensitive, no locale collation or Unicode normalization. Never reorder history records or mutate their IDs.
4. Serialize the sorted string array using ECMAScript `JSON.stringify(ids)` with no replacer and no spacing. Preserve standard JSON string escaping. Encode the resulting string as UTF-8 bytes using `Buffer.from(serialized, 'utf8')`.
5. Add NO BOM, NO trailing newline and NO extra whitespace. Compute SHA256 over exactly those bytes; represent the digest as lowercase hexadecimal.

Known synthetic vector: records with IDs `b`, `a` produce bytes `["a","b"]` and SHA256 `0473ef2dc0d324ab659d3580c1134e9d812035905c4781fdd6d529b0c6860e13`, independent of input record order. The official commitment remains count 1095 / the ID hash above. `historyFileSha256` separately hashes all original file bytes, including any original whitespace/BOM/newline; it is NOT the canonical ID hash.

The hash is a historical continuity/audit commitment, not a daily membership mechanism. Later history bytes may change through legitimate settlements. `baselineCommitment(records)` returns count/hash only; the optional isolated `auditBaselineBytes(originalBytes, freeze)` checks the original capture and emits only a sanitized audit summary. It does not write files and is never called implicitly during evaluation. Regenerating the ID hash can use the private inventory or the original snapshot; do not infer the baseline subset from current history position/timestamps.

Formal analysis accepts an explicit external `baselineAudit` attestation with schemaVersion `oos2r-baseline-audit-v1`, status PASS, baselineCount, baselineIdsSha256 and historyFileSha256 matching the frozen commitments. It does not require a raw ID file or any baseline records in the evaluation input. Missing/mismatching audit keeps PRELIMINARY while allowing collection-integrity diagnostics. PASS means the supplied audit matches the commitment, not independent authentication of its issuer or proof that today's history still contains the full old ID set. The operator must supply independently verified audit evidence, not merely copy public hashes and claim verification. This trust boundary is explicit; no signatures or automatic continuity reconstruction are claimed.

Official membership instead comes exclusively from the exact identities, positive writerGeneration, post-cut openedAt and committed Manifest/WAL creation inventory. A matching baseline hash never grants membership, and legacy records cannot be adopted without authoritative creation evidence.

The original OOS-2 freeze, analysis plan, provenance and evaluator are untouched. Original OOS-2 ended before any candidate cycle was formally observed because completeness was not prospectively verifiable, per operator-confirmed status. There is no backfill or inferred reconstruction of old cycle membership.

## Statistical contract

MeanAbsMomentum is the arithmetic mean of `abs(metadata.featureSnapshot.momentum)` over official PAPER_CONFIRMED records with settlement version `paper-outcome-settlement-v2`, source `paper-live-temporal-reference-v1` and W/L/T label in a cycle. All required momenta must be numeric and finite. Empty or malformed metric populations invalidate the metric; they never remove a candidate slot. ACCEPT uses **exactly <= 0.599936**, not score/confidence/raw Q50. DATA_INVALID is separately counted, not included in the W/L/T metric population or binary denominator.

Threshold was derived exclusively from IS: 100 records, 53 cycles, raw Q50 `0.599936477924654`. Operator <= was selected/confirmed retrospectively using IS + OOS-1. OOS-1 is not an independent prospective validation of the complete gate. No OOS-2/OOS-2R outcomes are used for design, tuning or cut selection.

Primary CI reuses the unchanged OOS-2 `clusterBootstrap`: cycle resampling with replacement, 10,000 replicates, xorshift32 seed 20260915, sorted cluster IDs, all W/L/T retained in their cluster, binary W/(W+L), TIE excluded from denominator. Percentiles 2.5% and 97.5% use linear interpolation; zero-binary resamples excluded and counted. Not a guarantee of financial edge. No early stopping or threshold/operator/formula retuning.

## Candidates, evidence and completeness

WAL CYCLE_OPEN_COMMIT establishes the prospective ordered census, not settlements or scheduler IDs. Order: openedAt ascending, cycleId lexicographic tie-break. Exact protocol/campaign and positive writerGeneration are mandatory. Pre-cut or equal-cut opens are excluded. The first 50 qualifying opens are fixed BEFORE filtering validity, completeness or outcomes. Invalid, broken and incomplete candidates retain their slots. #51 never replaces a slot. A candidate with temporally inconsistent records remains blocked in place. No lookup against the private baseline ID inventory is performed. Unverifiable WAL ordering blocks the entire analysis rather than selecting a guessed census.

`oos2rEvidence.js` replays complete WAL v1 bytes purely in memory, verifying sequence, hash chain, writer/intent/commit/seal transitions, generation uniqueness and inventory. It checks supplied projections against that authority; it never calls writable recovery or repairs files. Evidence inputs must be coherent snapshots of the dedicated campaign WAL, projections and full history; caller must not supply an arbitrarily truncated historical prefix. Hash chains are corruption checks, not authentication against malicious rewriting or synchronized rollback.

Membership requires exact protocolId/campaignId/cycleId/writerGeneration, authoritative manifest opening time and actual committed WAL creation. Every history ID must match the inventory exactly. Creation momentum snapshot cannot be changed by settlement. Legacy monitorCycleId, createdAt alone, settledAt, scheduler termination or history position never grant membership.

COMPLETE requires SEALED, matching validated projection, exact inventory, no duplicate/missing/extra/mismatched record, and each record CLOSED with a valid settlement timestamp not before opening. Allowed terminal labels: WIN, LOSS, TIE, DATA_INVALID. W/L/T also require the original official PAPER settlement provenance. **VOID, absent or unknown labels do not prove completion and are excluded from performance.** There is no retrospective decision to reclassify VOID. SEALED alone is not COMPLETE.

Formal analysis requires freeze and baseline integrity PASS, the fixed first50, all 50 complete, and no membership ambiguity or unverifiable ordering. An INVALID manifest can therefore permanently block this protocol's checkpoint: do not replace it, silently repair it or launch another campaign based on observed performance. Any successor requires independent review/authorization. Empty sealed inventories can be complete but have invalid/empty metrics, reported separately.

Before this gate the evaluator returns progress/integrity only and does not calculate performance or evaluate momentum against the threshold. After it, report all-selected counts, accepted-cycle W/L/T statistics, DATA_INVALID separately, binary WR, cycle coverage and cluster CI. Asset/direction/regime/setup/UTC opening-hour groups are exploratory only. Comparisons use frozen IS/OOS-1 reference counts descriptively; prior OOS-2 outcomes are not loaded. Expectancy and financial edge remain NOT_AVAILABLE without frozen payout, costs and slippage. WR is not profitability.

## Read-only use and activation boundary

`readOos2rFreeze()` verifies exact bytes before parsing and returns a deeply frozen, internally marked contract. `evaluateOos2r({ history, walBytes, manifests, baselineAudit })` accepts a caller-supplied coherent campaign snapshot and external audit attestation; it contains no broker, network, scheduler or file-writing entrypoint. Missing/broken inputs fail closed. Do not use the writable journal's recovery as a read-only evaluator. Automated tests use synthetic records/temp directories, never the official history or private ID inventory.

No environment settings, dashboard, Champion, strategy, provider, broker or original OOS-2 code changed. This commit does NOT enable WILL_CYCLE_EVIDENCE_ENABLED, start backend/PAPER, create the real campaign WAL or collect cycle 1/50. The immutable `activationAuthorized:false` records that this artifact grants no execution authority; future activation requires a separate operator authorization, never editing this freeze.

Before future activation: independently review the commit/hash, verify deployment includes this source and the approved capability/WAL runtime, confirm baseline continuity and zero prior records/manifests for this identity, choose a new empty dedicated evidence directory without resetting/reusing an old journal, and explicitly configure the frozen identities under separate authority. An activation after the cut is permitted; any earlier opened cycle remains ineligible.

Existing limits remain: stale locks and OPEN/INVALID restart states require authorized operator recovery; no proven Windows power-loss safety, arbitrary rollback resistance or multi-host coordination. These are not permission to infer completeness. This implementation stops at review, without activating collection.
