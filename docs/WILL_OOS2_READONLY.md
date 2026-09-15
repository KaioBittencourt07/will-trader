# OOS-2 read-only evaluator

Base inspected: c5da6a3121759a45e518535603cea03f2b214a94. The freeze commit records the value, but does not establish its formula. The separate provenance JSON records the operator-supplied deterministic reconstruction; this implementation does not claim to have rerun that reconstruction or accessed OOS-2 to choose a gate.

Run from the repository root:

```powershell
node backend/src/evaluateOos2.js PATH_TO_HISTORY_JSON
```

The CLI reads the history array and the existing freeze, tolerates a leading UTF-8 BOM in memory, and prints JSON to stdout. It does not import historyStore, provider clients, broker code or filesystem writers. The freeze stays byte-identical. Tests verify its original SHA256.

## Frozen selection

Official provenance fields follow learning/src/historyStore.js: cycle at metadata.context.monitorCycleId and settlementVersion/source at outcomeMetadata. Only PAPER_CONFIRMED executions with the exact monitor prefix, settlement version/source, and WIN/LOSS/TIE qualify. Grouping sees official records on both sides of edgeCut. A cycle with pre-cut (including equal-cut) and post-cut records is INVALID in its entirety. Invalid settledAt in an official cycle is also INVALID; it cannot establish temporal eligibility.

Eligible records are strictly post-cut official records in the selected checkpoint, including records later invalidated at the cycle level. Candidates have at least one such record. The first 50 are fixed by first official post-cut settledAt, then cycle ID, before integrity filtering; invalid/cross-cut candidates are never replaced. Later candidates are counted separately and excluded. Undatable-only cycles are reported as unorderable, excluded from denominators, and block formal analysis. Pre-cut-only cycles are excluded. Invalid cycles are never partially accepted.

The separate analysis-plan JSON freezes this plan before accessing real OOS-2. Settlement alone does not establish that all cycle members have arrived. The API requires independently confirmed completedCycleIds for all first 50 candidates to label FORMAL_FIRST_50. Without this evidence, including through the current CLI, output is PRELIMINARY and cannot inform decisions or tuning. No early stopping for high/low WR and no automatic LIVE promotion.

Threshold 0.599936 was derived exclusively from IS (raw Q50 0.599936477924654). The <= operator was selected/confirmed retrospectively using IS + OOS-1. OOS-1 is not independent prospective validation of this new gate. OOS-2 is the first untouched prospective validation of the complete threshold + operator contract.

MeanAbsMomentum is the arithmetic mean of abs(metadata.featureSnapshot.momentum) within a cycle. Values must be finite numbers; strings/null are not coerced. ACCEPT uses exactly <= 0.599936. The raw Q50 and score/confidence are never runtime gates. officialPreCutN=217 validates the freeze's declaration; it is not a requirement that an input history extract contain all pre-cut records. For reliable cross-cut detection, supply the complete history, including pre-cut records.

## Reporting conventions and limitations

- Binary win rate: WIN/(WIN+LOSS); TIE is reported separately.
- Coverage: coverageAllCandidates = acceptedCycles/candidateCycles; coverageValidCandidates = acceptedCycles/validCycles. Report accepted/rejected/invalid separately. Record coverage is accepted records / eligible records within the checkpoint. Zero denominators return null.
- Max losing streak: accepted records sorted by settledAt, then lexicographic string id (present IDs first), then original input index for absent/identical IDs. Without distinguishing IDs, that explicit fallback depends on the original input. WIN and TIE break a streak. Rejected records are outside this sequence.
- Main 95% interval: cluster bootstrap by monitorCycleId, 10,000 replacement resamples of whole cycles, deterministic xorshift32 seed 20260915. All W/L/T travel together through sufficient counts; each replicate uses W/(W+L). Zero-binary resamples are counted and excluded. Percentiles 2.5/97.5 use linear interpolation. Independent cycles remain an assumption; few clusters can yield degenerate intervals. No guarantee of financial edge.
- Secondary Wilson 95% interval is explicitly naive/descriptive: record-level binomial interval ignoring within-cycle correlation.
- Asset/direction/regime breakdowns use stored top-level labels and UNKNOWN when absent, solely as secondary diagnostics.
- No payout/cost model: financial expectancy and edge are NOT_AVAILABLE. No inference from win rate alone.
- The evaluator counts records as supplied; it does not silently deduplicate or infer missing cycle members. Complete, nonduplicated history is required for the intended dataset.

No threshold, formula or operator tuning on OOS-2. No broker execution. Implementation ends before commit for review.
