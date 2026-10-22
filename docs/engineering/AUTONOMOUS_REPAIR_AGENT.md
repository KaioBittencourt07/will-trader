# WILL Trader — Autonomous Engineering & Repair Agent

Status: Phase 1 read-only diagnostics plus Phase 2 workspace and candidate-decision policy gates implemented; actual isolated patch application and repair execution remain design-only.  
Scope: diagnostics and bounded code repair only. This document does not enable broker execution or production self-deployment.

## Objective

Build an engineering agent that can independently inspect approved project files, identify and reproduce software defects, propose the smallest safe patch, run relevant tests, inspect its own diff, and report evidence. The agent must never equate a successful edit with a verified fix.

## Non-negotiable invariants

1. **No live trading authority.** The repair agent has no broker credentials, order-placement tools, or authority to enable automated broker execution. Existing PAPER/MANUAL boundaries remain intact.
2. **No self-merging or self-deployment.** Changes are made on a dedicated branch and submitted as a pull request. A human reviews and merges.
3. **Protect research integrity.** Do not modify frozen experiment thresholds, OOS cutoffs/manifests, historical records, evaluation datasets, or result files as a way to make tests pass. Any intentional change to research protocol requires a separate reviewed change and new experiment version.
4. **Least privilege.** Read-only by default; writes limited to an isolated worktree and allowlisted source/test paths. No production secrets or environment dumps.
5. **Evidence-first.** Record the failing command, error output, suspected root cause, changed files, test commands and exit codes, and remaining uncertainty.
6. **Bounded attempts.** Maximum two patch-and-test iterations per issue by default. If still failing, stop and produce a diagnostic report instead of looping.
7. **Fail closed.** If repository state is dirty/unknown, tests are destructive, credentials are missing, dependencies are untrusted, or scope cannot be established, do not edit; report the blocker.
8. **Rollback on regression.** A patch that worsens the baseline or fails required checks is discarded from the candidate branch/worktree; preserve logs and the original failure.

## Agent loop

1. **Observe:** capture branch/commit, worktree state, runtime versions, relevant logs, and test baseline.
2. **Triage:** classify the issue (syntax/runtime, contract, data quality, provider/network, security, performance, flaky test, or unknown); estimate impact and confidence.
3. **Reproduce:** run the smallest deterministic reproduction possible. Separate external provider outages/rate limits from code defects.
4. **Plan:** state root-cause hypothesis, intended minimal change, files in scope, risk, and acceptance criteria before writing.
5. **Patch:** make a minimal diff on an isolated feature branch; never rewrite frozen research artifacts to silence a failure.
6. **Verify:** run targeted tests first, then relevant package/root suites, static checks, and security checks available in the repository. Report skipped checks explicitly.
7. **Review:** inspect the full diff for scope creep, secrets, changed contracts, unsafe side effects, and tests that were weakened or deleted.
8. **Decide:** if every required check passes, create/update a draft PR with evidence. Otherwise revert the candidate patch or stop for human intervention.
9. **Learn:** store a structured incident record (symptom, root cause, fix, tests, outcome, confidence) in a reviewable knowledge base. Learning means retrieval and evaluation against new cases—not silently changing model weights or granting new permissions.

## Autonomy levels

- **L0 — Observe:** collect diagnostics and recommend a fix; no writes.
- **L1 — Prepare:** create a patch in an isolated branch and run safe tests.
- **L2 — Submit:** open a draft PR after checks pass, with test evidence and explicit limitations.
- **L3 — Scheduled maintenance:** only after L1/L2 are reliable; execute pre-approved checks on a schedule with budgets, logs, alerts, and a kill switch.
- **Never autonomous:** merge to protected branches, deploy to production, alter broker execution settings, place trades, rotate or reveal secrets, change frozen experiment definitions, or disable failing tests to force green status.

Initial release target: L1, with L2 available only when repository permissions and CI are verified.

## Test and change policy

- Detect package scripts and repository instructions; do not guess test commands.
- Establish a baseline before patching. Distinguish pre-existing failures from regressions.
- Prefer deterministic, external-call-free tests. Provider/network diagnostics must use bounded timeouts and respect HTTP 429, Retry-After, cooldown, and backoff policies.
- Never retry a provider call blindly to force green status.
- Do not weaken assertions, delete tests, mock away the reported failure, or change expected results without proving the contract itself changed legitimately.
- For market/research code, verify timestamps, data provenance, stale-data handling, continuity, and replay determinism where relevant.
- Keep all outputs redacted: no API keys, tokens, cookies, personal data, or full environment variables in logs.

## Proposed implementation modules

1. `diagnostics/`: normalized error envelope, redaction, log capture, environment fingerprint.
2. `triage/`: issue classification, severity, confidence, affected contract and dependency map.
3. `repair-planner/`: structured plan and acceptance criteria; no write access.
4. `workspace-guard/`: clean-state check, allowed-path policy, branch/worktree isolation, diff-size limit.
5. `patcher/`: patch generation/application in the isolated workspace only.
6. `verification/`: targeted tests, package suites, static/security checks, baseline-vs-candidate result comparison.
7. `review-gate/`: diff audit, secret scan, protected-file rules, no weakened tests, explicit approval requirements.
8. `incident-memory/`: versioned JSON/Markdown records with provenance and outcome labels.
9. `reporter/`: concise summary of root cause, patch, test evidence, confidence, unresolved risks, and PR link.
10. `scheduler/` (later): opt-in, bounded scheduled runs with rate limits, alerting, kill switch, and no production write authority.

These modules are the target architecture. As of 2026-10-22, Phase 1 is implemented at `backend/src/engineering/readOnlyDiagnostics.js` with tests in `backend/src/engineering/readOnlyDiagnostics.test.js`. A pure, fail-closed Phase 2 policy check is implemented at `backend/src/engineering/workspaceGuard.js` with tests in `backend/src/engineering/workspaceGuard.test.js`. It checks branch isolation, a valid baseline commit, clean worktree status, bounded path lists, and an allowlist limited to `backend/src/engineering/**` and `docs/engineering/**`; it rejects traversal, absolute/Windows paths, protected segments, and paths outside the allowlist. The guard is a policy function only: it does not inspect Git or the filesystem, execute commands, write files, call networks, or contact a broker. A pure candidate-decision gate is also implemented at `backend/src/engineering/repairCandidateGate.js` with tests in `backend/src/engineering/repairCandidateGate.test.js`. It requires a recorded baseline failure, passing candidate checks, confirmed required checks and diff review, no detected secrets or weakened tests, allowlisted changed paths, and a maximum of two sequential attempts. It only returns a decision: it does not execute tests, inspect diffs, revert candidates, or modify repository state. The actual isolated worktree, patcher, reproduction/verification runner, automatic rollback, diff inspection, incident persistence, PR automation, and scheduler are not implemented. Earlier branch CI run #648 passed the backend suite (26/26 tests, 0 failures) before these Phase 2 policy gates were added; the new CI run is required to validate the latest increment. This validates backend tests only, not a full repair loop.

## Initial acceptance criteria

- A seeded, harmless test defect is diagnosed and repaired in an isolated branch.
- The agent reproduces the failure before editing and demonstrates the targeted test passes after the patch.
- A deliberately bad patch is rejected when tests fail.
- Dirty worktree, protected-path edits, secret-like output, and missing test commands stop the workflow safely.
- Attempt limits prevent infinite repair loops.
- No network/broker calls occur during replay or unit-test verification unless a test explicitly opts in.
- A report lists commands, exit codes, changed paths, test results, and skipped checks.
- The agent cannot merge, deploy, or execute broker operations.

## Delivery phases

**Phase 0 — Guardrails and contracts:** document protected paths, error envelope, and approval boundaries.  
**Phase 1 — Read-only diagnostics:** gather reproducible evidence and produce triage reports.  
**Phase 2 — Isolated repair:** branch/worktree, minimal patch, bounded test loop, automatic candidate rollback.  
**Phase 3 — Draft PR automation:** submit evidence-rich draft PRs only after gates pass.  
**Phase 4 — Evaluation harness:** seeded defects, regression cases, repair success rate, false-fix rate, regression rate, and cost/latency metrics.  
**Phase 5 — Scheduled operation:** enable only after evaluation targets are met and monitoring/kill switch are tested.

## Required report format

- Issue and severity
- Baseline commit and worktree status
- Reproduction command and observed result
- Root-cause hypothesis and confidence
- Patch summary and changed paths
- Verification commands with exit codes
- Baseline failures vs new regressions
- Security/scope review
- Unresolved risks and next action
- PR URL, if created

## Success metrics

Track verified repair rate, regression rate, false-fix rate, mean time to diagnosis, human rejection rate, percentage of changes with deterministic reproductions, and percentage of reports with complete evidence. Do not optimize for raw number of edits or green tests alone.
