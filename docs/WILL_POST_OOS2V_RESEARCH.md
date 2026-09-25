# WILL Trader — post-OOS-2V research (read-only)

Research base: `6bc0520ab6ff78e4f746fbd7e8be73230f380051`. The retired OOS-2V campaign, its freeze, evidence and history are immutable. This document is exploratory, not a new gate, statistical validation, trading recommendation, or authorization to start collection. No OOS-2U/V result is used to tune the frozen threshold/operator.

## Sources, reconstruction and interpretation

`backend/config/experiments/edge-gate-oos2v-retirement.json` fixes the snapshot: 1,648 history rows (SHA-256 `b37032814927d7927258d8f6d1a877fb14830d693eba0e85f1a30a23b56d6266`), WAL SHA-256 `2170b1b0991c47140e91ae1c741a1d744a1c91fc7e178f7b004187f18e24d033`, 50 manifests. `research/postOos2vResearch.js` refuses a history/WAL hash or manifest-count mismatch, replays/verifies evidence and recomputes the formal result before grouping records. Reproduce with `node research/postOos2vResearch.js --history <read-only will-history.json> --evidence-dir <read-only OOS-2V evidence directory>`. It writes only aggregate JSON to stdout; no production files. The raw history and WAL paths are deliberately not committed.

Frozen formal result: 50/50 SEALED and complete SUCCESS observations; 33 accepted, 8 rejected, 9 invalid-metric cycles; 74 accepted official records, 33 WIN, 35 LOSS, 6 TIE, binary N=68, WR=48.53%; cycle-bootstrap 95% interval [37.88%, 59.68%]. Financial expectancy/edge are **NOT_AVAILABLE** without a payout/cost contract. OOS-2V retired as `FORMAL_COMPLETION_NO_VALIDATED_EDGE`; do not promote to LIVE or extend its 50 slots. The interval assumes independent cycles and does not establish a financial edge. See `backend/src/evaluateOos2v.js` and the retirement artifact.

The evaluator calls a cycle `invalidMetric` when it has **zero official WIN/LOSS/TIE records** *or* when any official record lacks finite `metadata.featureSnapshot.momentum`. The nine here are all the former. An official record requires PAPER_CONFIRMED execution, `paper-outcome-settlement-v2`, source `paper-live-temporal-reference-v1`, and WIN/LOSS/TIE. Existing non-official records in these cycles have 25/25 finite momentum values and 25/25 feature snapshots; zero are missing/nonfinite. This is an eligibility label, not evidence of nine feature-computation failures.

## Phase 1 — exact nine cycles

Cycle suffixes below expand to `autonomous-paper-monitor-v1:<suffix>`. All nine manifests are SEALED with valid evidence and SUCCESS observation terminals. `M` means manifest/history record count; `O` official performance records; all `O=0`. Ages are observed initial quote ages (ms), not PAPER entry-reference ages. `SKIP` means `SKIPPED`; `DI` means terminal `DATA_INVALID`. No rows had stale initial data-quality status (`OK` for all 25 existing rows).

| Cycle | UTC opened | M/O | Terminal records and assets | Initial quote age ms | Root cause / confidence |
|---|---|---:|---|---:|---|
| 29836663 | 21:43:08 | 0/0 | no records | n/a | No admitted/persisted study; precise upstream reason **unknown** without request/scan trace. Not a momentum defect. |
| 29836665 | 21:45:05 | 4/0 | 4 SKIP: AUD/USD, NZD/USD, USD/CAD, GBP/JPY | 9,068–19,034 | No executable/official PAPER result; all snapshots/momentum present. |
| 29836673 | 21:53:05 | 4/0 | 4 SKIP: NZD/USD, USD/CAD, GBP/JPY, USD/CHF | 8,560–13,537 | Same. |
| 29836682 | 22:02:05 | 4/0 | 2 SKIP (EUR/USD, GBP/JPY); 2 DI (AUD/USD, GBP/USD) | 8,258–11,225 | Two planned PAPER entries missed the separate 30-second temporal-reference window (`PAPER_ENTRY_REFERENCE_WINDOW_MISSED`); no official WIN/LOSS/TIE. Initial market data were OK. |
| 29836688 | 22:08:06 | 2/0 | 2 SKIP: EUR/USD, BTC/USD | 600–4,647 | No executable/official PAPER result. |
| 29836692 | 22:12:06 | 2/0 | 2 SKIP: USD/JPY, BTC/USD | 504–15,465 | Same. |
| 29836694 | 22:14:06 | 3/0 | 3 SKIP: USD/CAD, USD/JPY, BTC/USD | 890–9,780 | Same. |
| 29836699 | 22:19:06 | 2/0 | 2 SKIP: USD/JPY, BTC/USD | 609–7,730 | Same. |
| 29836702 | 22:22:06 | 4/0 | 4 SKIP: GBP/USD, USD/JPY, GBP/JPY, BTC/USD | 872–27,945 | Same; one quote was near, but within, the frozen 30-second gate. |

Thus: one zero-record cycle (upstream cause unresolved), seven all-SKIPPED cycles (expected no-trade/selection outcome at record level; exact individual skip reasons can be examined in audit metadata), and one mixed SKIPPED/DATA_INVALID cycle (confirmed temporal entry-reference availability failure). There are no unresolved settlements in the final retirement snapshot. `backend/src/paperOutcomeSettlement.js` explicitly marks `DATA_INVALID` after planned click time + 30,000 ms without an at/after entry reference. This cannot be fixed by inventing an entry price or changing freshness. The mixed cycle's two PAPER attempts remained `PENDING_CONFIRMATION`, with no actual click time/entry price.

## Phase 2 — descriptive slices of accepted-cycle official records only

All tables below partition the **same 74 records in 33 accepted cycles**, not all 50 cycles. Columns: `N / W / L / T / binary N / binary WR %`; `*` marks binary N<10. Correlation within a cycle, multiple slicing, selection on the frozen gate, a short ~2-hour observation window, and absent payout/costs make subgroup WR unsuitable for claims of edge. TIE is excluded only from binary WR. No subgroup is a proposed live rule. UTC hour uses record creation time; cycle size is manifest inventory count (not number of winning trades). Buckets are fixed descriptive bins, not optimized cutoffs.

### Asset, class, direction, hour

| Asset | N/W/L/T | Binary N / WR |
|---|---:|---:|
| AUD/USD | 2/2/0/0 | 2 / 100.00% * |
| BTC/USD | 8/6/2/0 | 8 / 75.00% * |
| ETH/USD | 5/2/3/0 | 5 / 40.00% * |
| EUR/USD | 6/2/4/0 | 6 / 33.33% * |
| GBP/JPY | 8/2/6/0 | 8 / 25.00% * |
| GBP/USD | 4/2/0/2 | 2 / 100.00% * |
| NZD/USD | 3/1/1/1 | 2 / 50.00% * |
| SOL/USD | 7/5/1/1 | 6 / 83.33% * |
| USD/CAD | 2/1/1/0 | 2 / 50.00% * |
| USD/CHF | 6/2/4/0 | 6 / 33.33% * |
| USD/JPY | 14/3/10/1 | 13 / 23.08% |
| XRP/USD | 9/5/3/1 | 8 / 62.50% * |

| Slice | N/W/L/T | Binary N / WR |
|---|---:|---:|
| FX | 45/15/26/4 | 41 / 36.59% |
| Crypto | 29/18/9/2 | 27 / 66.67% |
| BUY | 31/15/14/2 | 29 / 51.72% |
| SELL | 43/18/21/4 | 39 / 46.15% |
| 21:00 UTC | 28/9/17/2 | 26 / 34.62% |
| 22:00 UTC | 46/24/18/4 | 42 / 57.14% |

Asset class and provider are confounded in this sample: FX uses Biquote tick + Twelve closed OHLC, while crypto uses Coinbase ticker + Twelve closed OHLC. A 2-hour sample cannot establish an hour effect. Asset-specific rows are mostly tiny.

### Records per cycle, momentum, quote freshness

| Slice | N/W/L/T | Binary N / WR |
|---|---:|---:|
| Manifest inventory 2 | 2/1/1/0 | 2 / 50.00% * |
| Manifest inventory 3 | 13/6/7/0 | 13 / 46.15% |
| Manifest inventory 4 | 59/26/27/6 | 53 / 49.06% |
| abs(momentum) <0.25 | 29/13/15/1 | 28 / 46.43% |
| abs(momentum) 0.25–<0.50 | 29/11/17/1 | 28 / 39.29% |
| abs(momentum) 0.50–<0.75 | 13/9/1/3 | 10 / 90.00% |
| abs(momentum) ≥0.75 | 3/0/2/1 | 2 / 0.00% * |
| Quote age ≤5,000 ms | 29/17/10/2 | 27 / 62.96% |
| Quote age 5,001–15,000 ms | 28/11/15/2 | 26 / 42.31% |
| Quote age 15,001–30,000 ms | 17/5/10/2 | 15 / 33.33% |

The abs(momentum) pattern is **non-monotonic** and selected after applying a cycle-level MeanAbsMomentum gate; it neither rescues that gate nor justifies a new threshold. Quote-age association is likewise confounded by asset, provider, timing and chance; the existing ≤30,000 ms admission gate remains untouched.

### Provider, regime/volatility, confidence and market context

| Slice | N/W/L/T | Binary N / WR |
|---|---:|---:|
| Twelve OHLC + Biquote FX tick | 45/15/26/4 | 41 / 36.59% |
| Twelve OHLC + Coinbase ticker | 29/18/9/2 | 27 / 66.67% |
| Regime LOW_VOLATILITY | 8/3/5/0 | 8 / 37.50% * |
| Regime TRANSITION | 1/1/0/0 | 1 / 100.00% * |
| Regime TREND_DOWN | 42/18/20/4 | 38 / 47.37% |
| Regime TREND_UP | 23/11/10/2 | 21 / 52.38% |
| Feature volatility <0.2 | 16/6/10/0 | 16 / 37.50% |
| Feature volatility 0.2–<0.5 | 48/22/21/5 | 43 / 51.16% |
| Feature volatility 0.5–<1 | 10/5/4/1 | 9 / 55.56% * |
| Confidence ≥70 | 74/33/35/6 | 68 / 48.53% |
| Macro status LOW | 74/33/35/6 | 68 / 48.53% |
| News status NEWS_UNKNOWN | 74/33/35/6 | 68 / 48.53% |

Confidence, macro and news have **no within-sample variation** and cannot discriminate winners. Confidence is a heuristic weighted evidence score (`engine/src/confidence.js`), not a calibrated probability. `NEWS_UNKNOWN` is not an assertion of news safety; the current context gate blocks only explicit `blocked` flags (`engine/src/willCore.js`).

## Phase 3 — code/data pipeline audit and weak links

1. **Observation and freshness.** `backend/src/routes/opportunities.js` scans a bounded asset set, fetches Twelve snapshots, composes FX Biquote or crypto Coinbase temporal quote with Twelve closed OHLC, then enforces market admission, canonical closed-candle proof and study fingerprint before analysis. The admitted history carries data-quality source/age and provenance. Initial quote freshness is not the same as the later entry/exit reference needed for PAPER settlement. The two `PAPER_ENTRY_REFERENCE_WINDOW_MISSED` rows prove that distinction. A relay/provider outage can yield a zero-record cycle; the specific cause for cycle 29836663 is not persisted in its manifest.
2. **Feature and strategy.** `engine/src/featureEngine.js` derives trend, momentum, structure, volatility, ATR, breakout/rejection/pullback/reversal and candle geometry from closed OHLC. `engine/src/willEngine.js` uses directional weights 0.35 trend + 0.30 momentum + 0.35 structure, score/volatility/confirmation heuristics and WAIT gates; `engine/src/setupClassifier.js`, `marketRegime.js`, `confidence.js`, `noTrade.js`, and `pipeline.js` add setup/regime/confidence/timing gates. The OOS-2V gate is a *separate retrospective evaluator* over mean absolute momentum per cycle, not an authorized strategy change. More features exist than have prospective incremental-value evidence.
3. **Selection and dependence.** `/api/opportunities` records analyzed studies, scanner readiness and ranking (`engine/src/scannerDiscovery.js`, `opportunityEngine.js`). Records in one monitor cycle share market time, providers and selection decisions; record-level WR/naive independence is inappropriate. No-trade, rejected and missing official outcome cycles must remain in collection-integrity accounting, rather than being discarded to make a performance table look better.
4. **PAPER outcome semantics.** `backend/src/paperOutcomeSettlement.js` needs a genuine temporal entry reference at/after the planned click, then an expiry reference; it returns `DATA_INVALID` rather than synthesizing either. This is correct fail-closed behavior, but a real availability/coverage gap. The initial freshness gate did not guarantee future tick availability.
5. **Market intelligence and AI.** Macro/news were constant LOW/NEWS_UNKNOWN in accepted records. The review/consensus layer (`backend/src/consensus.js`, `backend/src/ai/advisors.js`) can agree/veto, but shared input and heuristic confidence do not establish independent calibrated evidence. Unknown news and uncalibrated confidence should be reported as uncertainty, not silently treated as edge.
6. **Statistical/operational boundary.** The frozen 50-cycle OOS-2V result is weak and formally retired. Multiple post-hoc slices above create severe multiplicity/overfit risk. There is no frozen payout, costs/slippage, executable entry latency distribution, or independent live confirmation; financial expectancy and capital suitability cannot be computed.

## Phase 4 — next research hypotheses (not deployment gates)

The following are **mechanism-first proposals**. None was selected by maximizing these subgroup WRs. Any threshold, signal rule, sample size, payout model, stopping rule and comparison must be frozen **before** a fresh, independent prospective collection. Existing retired data remain exploratory only; no OOS-2V record may be reused as confirmatory validation.

| Hypothesis | Mechanism and existing evidence | Production/data change required | Main overfit risk | Prospective falsification |
|---|---|---|---|---|
| **H1 — temporal execution reliability (selected)** | A timely decision is useless if PAPER entry/expiry reference is not prospectively captured. Two genuine entry-window misses occurred despite OK initial market data; source timestamp and planned click already exist. Test reliability/coverage first, not WR. | Read-only shadow instrumentation of planned click, actual reference arrival, lag, missing reason, provider, asset class and feed uptime; preserve 30s window, no synthetic reference or strategy edit. Later freeze a coverage/service-level hypothesis and minimum follow-up length. | Optimizing only on cycles with successful entry creates survivorship bias; provider/time mix confounds. | Across a separately frozen future window (at least 50 complete cycles and several trading sessions), predeclared reference-coverage and lag targets fail, or missingness remains material/asset-concentrated; count all planned entries including invalid/missing. |
| H2 — market-structure confirmation adds information | Closed-candle breakout/rejection/pullback, ATR and trend/structure are already computed; an event-level rule might distinguish meaningful structure from noisy momentum. No current subgroup WR validates one. | Offline feature-validity audit first; SHADOW-only candidate with one predeclared mechanism and exact feature semantics; no Champion change. | Many correlated features/setups, asset/time confounding, data snooping across post-hoc tables. | In untouched prospective cycles, structural evidence fails to improve predeclared directional/payout-aware outcome versus unchanged Champion under cycle-cluster uncertainty; report coverage and missingness. |
| H3 — independent market-context veto | Material scheduled macro/news events may invalidate short-horizon price-action signals; current accepted sample is all LOW/NEWS_UNKNOWN and cannot assess this. | Acquire timestamped, licensed, audited event feed; record event publication/receipt time and strict unknown handling; SHADOW veto only after freeze. | Event windows, asset exposure and release lags are easy to tune retrospectively; provider availability bias. | Prospective comparison finds no improvement or unacceptable false veto/missingness, with unknown events counted explicitly. |

**Selection:** H1 has the clearest directly observed operational mechanism, reuses existing timestamp/provenance fields, and can be tested without changing strategy or interpreting 74 selected outcomes. It is a *commissioning/data-quality research priority*, not a claim of improved WR. A minimum viable prospective test should pre-register an all-planned-entry denominator, 30s reference deadline, per-provider/class lag and invalid rates, at least 50 complete cycles spanning multiple sessions, and no early stopping. Decide exact numeric service targets from operational requirements **before** looking at new outcome data. Only after execution integrity is demonstrated should a separate, untouched performance hypothesis be considered.

## Phase 5 — commissioning gaps, priority

1. **P0 — entry/expiry temporal reference coverage and telemetry.** Preserve fail-closed `DATA_INVALID`; add read-only diagnostics of planned-time to first valid reference, missed windows and provider health, with full denominator. Investigate the two observed entry misses without replaying or repairing retired evidence.
2. **P0 — zero-record and SKIPPED reason observability.** Persist/report sanitized per-cycle admission/selection reason counts prospectively so 0-record SUCCESS is attributable; do not retroactively fabricate it. Distinguish no signal, dedup, provider unavailable and data gate failure.
3. **P1 — independent outcome economics.** Freeze payout, spread, fees/slippage and PAPER-vs-real execution assumptions before any expectancy claim. Continue PAPER/read-only; no broker orders or automatic LIVE promotion.
4. **P1 — temporal/provider coverage across sessions.** The retired sample spans about two UTC hours, with FX and crypto tied to different quote providers. Qualify uptime, freshness and asset coverage across sessions before treating any asset/hour difference as general.
5. **P2 — calibration and context provenance.** Verify confidence semantics, timestamped news/macro availability and truly independent review value in SHADOW. Unknown news is an explicit information gap, not a negative event signal.

**Recommendation:** OOS-2V stays retired. No threshold retuning, new PAPER campaign, Champion/dashboard/broker change, or LIVE promotion follows from this report. The next authorization, if any, should be a separately reviewed, pre-registered shadow/commissioning protocol addressing H1 and P0 integrity before performance testing.
