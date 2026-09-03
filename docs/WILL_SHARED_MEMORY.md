# WILL TRADER — Shared Memory Protocol

## Purpose
Keep ChatGPT and Codex aligned through the repository instead of relying on ephemeral chat memory.

## Roles
### ChatGPT
- architecture;
- technical/statistical research;
- hypothesis design;
- review/audit;
- risk/overfitting checks;
- experiment design;
- priority decisions.

### Codex
- repository inspection;
- implementation;
- refactoring;
- tests;
- telemetry;
- reproducible execution;
- delivery reports.

### GitHub repository
Source of truth shared by both.

## Canonical memory files
- `docs/CODEX_HANDOFF.md` — current execution handoff and frozen decisions.
- `docs/WILL_ARCHITECTURE.md` — target architecture and contracts.
- `docs/WILL_ROADMAP.md` — phases and Definition of Done.
- `docs/WILL_SHARED_MEMORY.md` — collaboration protocol.
- `docs/DELTA_REPORT_YYYYMMDD.md` — delta between workspace and repository.
- `docs/WILL_DECISIONS.md` — future architecture decision log.
- `docs/WILL_EXPERIMENTS.md` — future experiment registry/index.
- `docs/WILL_METRICS.md` — future metric definitions.

## Work cycle
1. ChatGPT defines or audits hypothesis/architecture.
2. Decision is written/versioned in repository if it changes project truth.
3. Codex reads canonical docs before coding.
4. Codex implements on dedicated branch.
5. Codex runs tests and records exact result.
6. Codex documents files changed, telemetry and open risks.
7. GitHub commit/PR becomes the transfer object back to ChatGPT.
8. ChatGPT reviews diff/results and decides next hypothesis or promotion.

## Required Codex preflight for every substantial round
Before coding:
1. read `docs/CODEX_HANDOFF.md`;
2. read `docs/WILL_ARCHITECTURE.md`;
3. read `docs/WILL_ROADMAP.md`;
4. identify current branch/head;
5. compare against latest local/workspace version when applicable;
6. run baseline tests;
7. verify no secrets are about to be committed.

## Required Codex completion report
Every substantial delivery must provide:
- branch and commit SHA;
- files changed;
- tests/checks executed and outcomes;
- endpoints/contracts changed;
- telemetry observed;
- migrations required;
- assumptions made;
- blockers/open risks;
- explicit list of items intentionally not implemented;
- recommended next step.

## Decision discipline
A project-level decision is not considered durable until captured in repository documentation or code/config with version history.

Examples that MUST be durable:
- thresholds;
- strategy version;
- feature formula;
- timeframe combination;
- outcome definition;
- promotion criteria;
- risk veto;
- probability calibration policy;
- provider fallback policy.

## Experiment discipline
Every strategy experiment should contain:
```text
experimentId
hypothesis
championVersion
challengerVersion
parameterSet
start/end or target sample
primaryMetric
secondaryMetrics
segments
promotionCriteria
stopCriteria
result
status
```

Allowed statuses:
- PROPOSED
- RUNNING_SHADOW
- RUNNING_PAPER
- REJECTED
- CHALLENGER
- PROMOTED
- RETIRED

## Frozen safety principle
Neither ChatGPT nor Codex should silently transform WILL from PAPER/MANUAL into real-money automated execution. That requires a separate future architecture/security decision and explicit user direction.

## Statistical principle
Do not optimize from anecdotes. Changes are evaluated against versioned batches and temporal/out-of-sample evidence. Heuristic confidence is not win probability.

## Synchronization phrase for future rounds
When Codex starts a new substantial task, treat the following as the default instruction:

> Read the canonical WILL docs in `docs/`, inspect the current branch/workspace delta, preserve frozen decisions, run baseline tests, implement only the next approved phase, and return a reproducible completion report with commit SHA, tests, telemetry and remaining risks.

## Fase 19 — reliability hardening
- `entry-timing-v2`: `TOO_EARLY` is used when `current < validFrom`; `LATE_ENTRY` is reserved for an expired window.
- Error attribution is evidence-only. A standalone `LOSS` remains `UNKNOWN`; a specific cause requires explicit persisted evidence.
- The PAPER runner may hydrate `completedCycleIds` from durable storage. Without durable storage, restart safety is not guaranteed.
- PAPER/MANUAL remains mandatory. No Avalon auto-click, threshold change, calibration or promotion is authorized.

