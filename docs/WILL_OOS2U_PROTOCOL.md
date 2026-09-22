# WILL Edge Gate OOS-2U

OOS-2U is prospective, PAPER-only infrastructure. This commit creates no production freeze, campaign, edge cut, evidence directory, or runtime.

The frozen statistical contract remains `MeanAbsMomentum <= 0.599936`, first 50 exact campaign cycles ordered by `openedAt` then `cycleId`, no replacement, and cycle-cluster bootstrap (`10000`, seed `20260915`, `xorshift32`). `DATA_INVALID` and `OPERATIONAL_FAILURE` occupy their original slot and are excluded from performance. Financial expectancy is `NOT_AVAILABLE`.

The freeze finalizer defaults to `DRY_RUN`. Writing requires the explicit write flag and backend-stopped confirmation, creates an exact SHA-256 sidecar transactionally, and refuses overwrite. The strict freeze schema rejects unknown fields and freezes `baselineRecordsSha256`, a canonical full-record digest in addition to the ID and original-file commitments.

First activation requires `START_APPROVED_OOS2U_FIRST_COLLECTION_V1`, exact freeze identity, absolute paths, a new evidence directory, clean scan roots, exact baseline bytes, and a time after the frozen edge cut. Restart is a separate mutually exclusive mode requiring `RESTART_APPROVED_OOS2U_EXISTING_COLLECTION_V1`; it never creates, deletes, or repairs evidence. It revalidates the canonical baseline prefix against the current history before recovery. Symlinks fail closed.

The runtime admits at most 50 cycles. Every cycle must seal as `SUCCESS` or bounded uppercase `OPERATIONAL_FAILURE`; storage, WAL, projection, membership, or inventory corruption is never downgraded into an operational observation failure. Restart accepts fully sealed structurally valid cycles whose trade records are either terminal or exactly `PENDING` / `TRADE_NOT_TERMINAL`. Manual confirmations and every other invalid lifecycle fail closed. At 50 it remains closed while settlement may continue; before 50 safe recovery may continue without replacing slots. Unsafe recovery requires operator action and never deletes evidence.

`evaluateOos2u` is the sole formal-analysis authority. It requires a cryptographically verified freeze, verified baseline, exact identity and temporal membership, exactly 50 complete cycles, and no ambiguous or excess evidence. The status projection calls this authority and omits partial win rate, edge, confidence interval, and bootstrap results.

Automated broker execution is false. There is no LIVE promotion.
