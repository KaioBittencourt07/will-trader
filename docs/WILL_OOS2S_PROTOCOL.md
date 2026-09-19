# WILL Edge Gate OOS-2S — prospective terminal semantics

OOS-2S is a PAPER/read-only successor, not a repair of OOS-2R. The operator stopped OOS-2R after observing a protocol-completeness defect: its authoritative inventory may contain WAL-born `SKIPPED` records while the historical verifier requires every inventory record to become `CLOSED` with an outcome. Settlement does not settle `SKIPPED`, and the history store correctly rejects settlement of non-`OPEN` rows. This makes formal completeness impossible once such a slot exists. The stop was structural, not based on performance. The operator-captured hashes and counts are recorded in `edge-gate-oos2r-retirement.json`; Codex does not claim to have reverified unavailable local bytes. OOS-2R freeze, WAL, manifests, records and evaluator remain unchanged.

OOS-2S preserves `MeanAbsMomentum <= 0.599936`, raw IS Q50 `0.599936477924654`, first 50 slots, deterministic cluster bootstrap (10,000 replications, seed 20260915, xorshift32), no retuning, no early stopping and no automatic LIVE promotion. OOS-1/OOS-2/OOS-2R cannot tune this contract.

## Terminal classifier

`TRADE_TERMINAL` requires `CLOSED`, a valid `settledAt >= manifest.openedAt`, and `WIN`, `LOSS`, `TIE`, or separately classified `DATA_INVALID`. W/L/T additionally require `PAPER_CONFIRMED`, `paper-outcome-settlement-v2`, and `paper-live-temporal-reference-v1`.

Every terminal row must retain exact membership, context cycle ID, and an immutable WAL-born decision projection (`asset`, `timeframe`, `direction`, `regime`, `setup`, and `metadata.featureSnapshot`). Settlement-only fields may evolve. A trade terminal must originate as an OPEN BUY/SELL; a WAL-born SKIPPED can never be rewritten into a trade or DATA_INVALID terminal.

`NO_TRADE_TERMINAL` requires an unchanged record that authoritatively originated in `RECORD_CREATE_INTENT` as `SKIPPED` with null execution, outcome, settledAt and clickTime, and remains so. Direction is deliberately irrelevant: a blocked BUY or SELL can be born skipped. No outcome or settlement timestamp is synthesized. No-trades satisfy inventory completeness but never enter momentum, binary N, WR or bootstrap. A no-trade-only cycle is complete for inventory and invalid for the metric; its slot is retained.

The first 50 matching WAL OPENs are ordered by `openedAt`, then `cycleId`. INVALID, OPEN, incomplete and metric-invalid slots remain fixed and are never replaced by slot 51. Before all formal gates pass, evaluator/status output contains no performance.

## Settlement isolation

When OOS-2S is prepared, automatic settlement is passed the exact protocol and campaign. Both are mandatory; partial scope fails closed. Therefore the unresolved OOS-2R OPEN is not considered or mutated. Legacy prefix behavior remains only when no explicit evidence scope is active. Health reports the non-secret scope mode and identities.

## Local freeze finalization

No final OOS-2S freeze or baseline ID hash is fabricated in the review workspace. With backend and monitor stopped, the operator runs the finalizer against the real 1108-record history and OOS-2R evidence. Dry-run performs no writes and verifies the exact history and journal hashes, replays 23 valid SEALED projections, confirms zero INVALID/OPEN and total inventory 12, then derives the canonical ID hash from unique IDs sorted lexicographically and `JSON.stringify` encoded as UTF-8 without a trailing newline.

```powershell
Set-Location C:\Users\skdri\will-trader-commissioning\backend
$edgeCut = Read-Host 'Operator-approved UTC edgeCut (for example 2026-09-19T15:00:00.000Z)'
node scripts/finalizeOos2sFreeze.mjs --edge-cut $edgeCut
```

After independent review of the printed summary, final creation is explicit and exclusive:

```powershell
node scripts/finalizeOos2sFreeze.mjs --edge-cut $edgeCut --confirm-backend-stopped --write
```

The writer also requires edgeCut to be strictly later than every valid baseline history `createdAt`/`settledAt` and every OOS-2R manifest `openedAt`/`sealedAt`. It creates `edge-gate-oos2s-freeze.json` and its `.sha256` sidecar only when absent. The reader pins bytes to that sidecar, deep-freezes the verified object, rejects missing/malformed/tampered files, and has no environment bypass. The dry-run never writes.

## First start and recovery

The reviewed environment template keeps the monitor OFF. First-start preflight checks freeze integrity, exact baseline count, canonical ID hash and full history-file SHA, absence of prior OOS-2S membership/evidence, an absent target directory, and strict time after edgeCut. It creates no directory, WAL, manifest, cycle or record. The same full continuity check repeats immediately before the first authoritative OPEN; mutation pauses fail closed.

Restart is separate from first start. The current delivery provides only a read-only restart inspector: existing directory, no lock, valid WAL replay/projections, exact identity and sealed-only state. Writable recovery remains `NOT_AUTHORIZED`; it never deletes/truncates WAL, resets generation or creates a replacement directory.

Formal baseline audit is caller-supplied but byte-derived through `auditOos2sBaselineBytes`; copied commitment values are not an audit. After first start, the expected audit source is the immutable pre-monitor backup `will-history.json.bak`, not the evolving live history. The evaluator itself remains pure and does not open files.

Future activation identity is `will-edge-gate-oos2s-v1` / `will-edge-gate-oos2s-20260919-v1`, with evidence at `backend/data/oos2s-evidence-20260919-v1`. It remains PAPER only. This work starts no server, monitor, provider, broker, order, campaign or collection and grants no LIVE authorization.
