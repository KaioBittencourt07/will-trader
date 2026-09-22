# WILL OOS-2T terminal observation protocol

OOS-2S was retired for a structural reason: operational `runCycle` failures were collapsed into `INVALID` manifests, even when no evidence corruption existed. OOS-2T (`will-edge-gate-oos2t-v1`) separates observation availability from evidence integrity. This implementation does not create a production freeze, campaign, edge cut, baseline, or evidence directory.

## State machine

An OOS-2T cycle follows `OPEN -> writers/record commits -> CYCLE_OBSERVATION_COMMIT -> SEALED`. Exactly one terminal is required. `SUCCESS` has no reason code. `OPERATIONAL_FAILURE` has one deterministic uppercase reason code, limited to 64 characters. After the terminal, no writer or record is admitted. An evidence/WAL/projection/membership failure remains fail-closed and pauses or invalidates the cycle; it is never relabeled as an operational observation failure.

Evidence-backed opportunity requests stage their complete record batch in memory. Only a successful completed response commits the batch to WAL and then atomically persists the history file. A later provider/asset failure discards the entire staged batch, allowing a zero-record operational terminal without partial history. A WAL or history failure during commit is an integrity failure and pauses recovery; it is never downgraded to an operational terminal.

The existing `paper-cycle-evidence-wal-v1` gains one additive event. The event does not mutate inventory or membership. Its strict sequence and hash participate in the existing chain. The requirement is opt-in (`observationTerminalRequired`) so historical OOS-2R and OOS-2S journals contain no such event and retain their prior replay shape and meaning.

## First 50 and performance

Candidates are ordered by `openedAt`, then `cycleId`; the exact first 50 are fixed with no replacement, cherry-picking, or early stopping. A SEALED operational failure is structurally complete, occupies its slot, has no synthetic record/outcome, and contributes no performance or MeanAbsMomentum. A successful zero-record cycle is also structurally complete but metric-invalid. Successful cycles retain the OOS-2S rules: immutable creation fields, unchanged `SKIPPED` as no-trade, exact PAPER provenance for `WIN/LOSS/TIE`, and distinct terminal `DATA_INVALID` excluded from performance.

Formal analysis requires baseline integrity, evidence integrity, exactly 50 candidates, and all 50 structurally complete. The statistical contract stays frozen at `MeanAbsMomentum <= 0.599936`; cluster bootstrap, no-retuning, PAPER/read-only operation, unavailable financial expectancy, and no automatic LIVE promotion remain unchanged.

Every exact-campaign manifest must have `openedAt > edgeCut`. Equality, an earlier timestamp, or an invalid timestamp is structural temporal-membership failure in status, evaluation, and restart inspection; such cycles are never filtered away.

The evaluator accepts neither caller booleans nor textual `PASS` assertions. A future freeze must be loaded from exact bytes verified by a SHA-256 sidecar, and a baseline audit must independently match the frozen count, canonical ID digest, and complete history-file digest. The generic validator pins protocol, campaign, edge cut, metric, threshold, operator, 50-cycle checkpoint, bootstrap contract, and governance flags without inventing production values.

## Security and recovery

Only bounded codes are durable. Tokens, headers, API keys, passwords, secrets, credential-bearing URLs, stack traces, arbitrary provider text, and multiline errors are prohibited. Recovery replays the hash chain and terminal deterministically. A missing/duplicate terminal, post-terminal writer, truncated/corrupt WAL, corrupt projection, membership mismatch, or true `INVALID` blocks formal analysis.

The status surface is read-only and exposes only structural counts and sanitized reason-code counts. Starting backend collection, PAPER, providers, broker execution, or a real OOS-2T campaign is outside this implementation.

A thrown PAPER settlement pass is an integrity/runtime failure and pauses evidence. It is not a normal provider observation failure and cannot create an `OPERATIONAL_FAILURE` terminal. Ordinary bounded settlement states and terminal `DATA_INVALID` retain their separate meanings.

`backend/scripts/finalizeOos2tFreeze.mjs` is dry-run by default. A future operator must supply absolute history/output paths, campaign ID and edge cut; optional historical evidence roots extend the temporal boundary proof. Writing additionally requires both `--write` and `--confirm-backend-stopped`. The tool derives commitments from the original bytes, pins the current Git HEAD, writes freeze plus SHA-256 sidecar atomically, then rereads and audits both.
