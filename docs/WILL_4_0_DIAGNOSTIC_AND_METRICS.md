# WILL 4.0 — Diagnostic, Failure Modes and Metrics Plan

## Objective

Prevent repeated mistakes, hidden feedback loops, overfitting, stale-signal behavior and silent degradation as WILL evolves. This document defines the operational risk register, the metrics that should be measured, and the anti-cycle controls required before broader automation.

## Current strengths

- Market Admission is separate from strategy logic.
- Canonical-study deduplication prevents repeated identical evidence from being counted as new evidence.
- Scanner round state distinguishes data/admission failure from strategic WAIT.
- Released plans and click-now executability are separate states.
- History records strategy/model/feature versions, provenance, data quality, timing, context and outcomes.
- Research memory is isolated from production and requires out-of-sample evidence before VALIDATED.
- Market Intelligence preserves UNKNOWN instead of fabricating SAFE.
- AI advisors are secondary reviewers; deterministic WILL remains directional authority.

## Highest-probability failure modes

### R1 — False learning from correlated or duplicated samples

Risk: many records can describe effectively the same market state and make a strategy appear statistically stronger than it is.

Controls:
- retain canonical fingerprint deduplication;
- add correlation-window dedup by asset/timeframe/regime/setup;
- report unique canonical states separately from raw scan count;
- never count repeated WAIT polls as independent evidence.

Metrics:
- rawScans;
- uniqueCanonicalStudies;
- duplicateStudyRate;
- uniqueStateRatio = uniqueCanonicalStudies / rawScans.

### R2 — Selection bias / only recording attractive signals

Risk: recording only released BUY/SELL candidates hides how many valid studies became WAIT or were rejected.

Controls:
- preserve admitted WAIT studies as research evidence;
- record scanner funnel counters every round;
- separate data rejection, canonical rejection, strategic WAIT and directional-no-release.

Metrics:
- observed;
- dataAdmitted;
- canonicalAdmitted;
- strategicWait;
- directionalStudies;
- releasedCandidates;
- clickReadyCandidates;
- confirmedExecutions;
- settledOutcomes.

### R3 — Outcome bias and incomplete execution truth

Risk: WIN/LOSS attached to a signal that was never actually executed, or execution time/price differs materially from plan.

Controls:
- separate planned signal, released signal, confirmed execution and settled outcome;
- do not compute live execution win rate from unconfirmed signals;
- track execution delay and entry slippage when available;
- treat unexecuted released plans as a separate counter, not LOSS or WIN.

Metrics:
- releaseToExecutionRate;
- medianExecutionDelayMs;
- p95ExecutionDelayMs;
- plannedVsActualEntryDelta;
- executionConfirmedCount;
- unexecutedReleasedCount.

### R4 — Parameter drift caused by reacting to short streaks

Risk: changing thresholds after a few losses/wins creates a tuning loop and destroys out-of-sample validity.

Controls:
- freeze production strategy version for a prospective evidence window;
- all parameter changes create a challenger version;
- minimum evidence threshold before promotion;
- no production edits based on a single day/session/streak.

Metrics:
- strategyVersionAge;
- samplesPerVersion;
- parameterChangesPer100Studies;
- challengerPromotionRate;
- rollbackRate.

### R5 — Overfitting research/video concepts

Risk: translating every educational idea into a production rule creates feature creep and curve fitting.

Controls:
- research hypothesis -> explicit feature -> replay -> prospective evidence -> out-of-sample review -> guarded promotion;
- cap simultaneously active challenger hypotheses;
- reject hypotheses with unclear mathematical definition.

Metrics:
- proposedHypotheses;
- observingHypotheses;
- validatedHypotheses;
- rejectedHypotheses;
- validationRate;
- medianSamplesBeforeDecision.

### R6 — AI confirmation bias

Risk: the AI learns to agree with WILL or the operator interprets confident language as evidence.

Controls:
- AI never creates direction;
- store AI agreement/veto/abstain independently;
- calibrate AI confidence against outcomes;
- compare performance WITH and WITHOUT AI veto using shadow evaluation;
- prompts/version/model must be versioned.

Metrics:
- aiAvailabilityRate;
- aiAgreementRate;
- aiVetoRate;
- aiAbstainRate;
- outcomeRateWhenAgreed;
- outcomeRateWhenVetoedShadow;
- calibrationByConfidenceBucket;
- modelVersionBreakdown.

### R7 — Silent provider degradation

Risk: a provider remains connected but timestamp quality, freshness, request success or semantic quality degrades.

Controls:
- health is per role: transport, temporal authority, OHLC, macro, news;
- no single green "provider online" flag;
- alert on freshness, error-rate and semantic-state changes;
- preserve fail-closed behavior.

Metrics:
- providerRequestSuccessRate;
- provider429Rate;
- providerTimeoutRate;
- freshnessPassRate;
- authorityPassRate;
- consecutiveFailureCount;
- timeSinceLastQualifiedSnapshot.

### R8 — Notification loops / stale WhatsApp signals

Risk: same candidate is sent repeatedly, or a message arrives after the valid entry window.

Controls:
- notification idempotency key = signalId + lifecycle state;
- send RELEASED once;
- send EXPIRED/CANCELLED once if state changes;
- never notify duplicated canonical study;
- suppress if validUntil is already expired at send time;
- delivery status must not alter trading state.

Metrics:
- notificationsSent;
- duplicateNotificationSuppressed;
- expiredBeforeSend;
- deliverySuccessRate;
- medianNotificationLatencyMs;
- releaseToNotificationLatencyMs.

### R9 — Scanner starvation or cycle lock

Risk: AutoScan repeatedly studies the same asset/state, repeatedly gets WAIT_TIMING, or one failing provider blocks rotation.

Controls:
- bounded per-asset dwell time;
- canonical fingerprint dedup;
- per-asset cooldown after repeated infrastructure failure;
- round-level fairness so one asset cannot monopolize scans;
- distinguish strategic WAIT from infrastructure rejection.

Metrics:
- scansPerAsset;
- admittedStudiesPerAsset;
- medianTimeBetweenUniqueStudies;
- consecutiveSameStateCount;
- assetRotationEntropy;
- starvationSecondsPerAsset.

### R10 — Metric illusion from small samples

Risk: high apparent win rate with tiny n produces false confidence.

Controls:
- every percentage displayed with sample count;
- confidence intervals or Bayesian credible intervals for outcome rates;
- hide/label performance claims below minimum n;
- segment only when each segment has enough evidence.

Metrics:
- n alongside every rate;
- Wilson interval for binary outcomes;
- minimumN threshold;
- effectiveSampleSize after correlation/dedup.

### R11 — Regime blindness

Risk: aggregate performance hides that the strategy only works in a subset of volatility/trend/macro regimes.

Controls:
- persist regime/setup/context fingerprint for every admitted study;
- segment outcomes by trend, volatility, setup, macro, news coverage and timing state;
- never promote based only on aggregate performance.

Metrics:
- outcome by regime;
- outcome by setupType;
- outcome by volatility bucket;
- outcome by macro status;
- outcome by AI state;
- outcome by session/hour;
- outcome by score/confidence decile.

### R12 — Data leakage / look-ahead

Risk: features accidentally use an open candle, future outcome data, post-signal macro/news or later revisions.

Controls:
- canonical closed candles only;
- timestamp each feature snapshot;
- event/news context fingerprint fixed at decision time;
- replay uses the exact recorded snapshot/version, not recomputed future data;
- no retrospective feature substitution.

Metrics:
- featureTimestamp <= decisionTimestamp invariant;
- closedCandleProofPassRate;
- replayHashMatchRate;
- contextFingerprintReplayMatchRate.

## Core dashboard diagnostic funnel

Every AutoScan round should expose this funnel:

`observed -> market admitted -> canonical unique -> WILL studied -> strategic WAIT / directional -> released -> click ready -> notified -> execution confirmed -> settled`

The dashboard should show absolute counts AND conversion percentages between stages. A drop between stages is not automatically bad; it becomes diagnostic evidence.

## Required statistical views

### 1. Data quality panel

- freshness PASS/FAIL;
- temporal authority PASS/FAIL;
- provider errors/429/timeouts;
- canonical rejection reasons;
- latest qualified timestamp.

### 2. Scanner funnel panel

- rounds;
- unique canonical studies;
- duplicate rate;
- strategic WAIT rate;
- directional rate;
- candidate release rate;
- click-ready rate.

### 3. Performance panel

Only confirmed, settled executions belong in primary execution performance.

- WIN / LOSS / TIE / VOID / DATA_INVALID;
- sample count;
- outcome rate + interval;
- streak distribution;
- max losing streak;
- max winning streak;
- performance by setup/regime/hour/score bucket.

### 4. Execution-quality panel

- planned click time vs actual click time;
- planned entry vs actual entry;
- expired before execution;
- released but not executed;
- operator confirmation latency.

### 5. AI audit panel

- configured/available;
- agreement/veto/abstain;
- confidence calibration;
- provider/model/prompt version;
- incremental value vs deterministic baseline using shadow comparison.

### 6. Context panel

- macro coverage/freshness;
- nearest high-impact event;
- news coverage/freshness;
- FULL/PARTIAL/UNKNOWN;
- outcome segmentation by context regime.

### 7. Notification panel

- signal notifications;
- duplicate suppression;
- expiry/cancel notifications;
- send latency;
- delivery failures.

## Anti-cycle rules

1. No production threshold changes during an active prospective evidence window.
2. Every new idea receives a hypothesis ID and challenger version.
3. One hypothesis must not be tuned repeatedly on the same evaluation set.
4. A failed provider is fixed at the provider/admission layer, never by weakening a strategy gate.
5. A low candidate count is not a reason to lower freshness, timing or canonical requirements.
6. WAIT is not failure and must never be optimized away merely to increase activity.
7. Notifications never cause rescans or strategy decisions.
8. AI output never becomes training truth by itself.
9. Dashboard metrics distinguish raw observations from independent/unique evidence.
10. Promotions require prospective/out-of-sample evidence and explicit operator approval.

## Recommended priority

### P0 — Measurement before more strategy

Build a Diagnostic Metrics Aggregator and expose `/api/diagnostics` plus a dashboard panel. This is the highest leverage next step because every future feature can then be judged by evidence.

### P1 — Outcome integrity

Ensure released, executed and settled are distinct throughout UI/history. Add automatic checks for open signals that expire without execution.

### P2 — AutoScan loop protection

Add per-asset dwell/cooldown/fairness metrics and loop detectors.

### P3 — OpenAI shadow evaluation

Initially record advisor output without allowing it to change release. Measure agreement, veto and hypothetical incremental value before enabling veto in production.

### P4 — Notification lifecycle

Idempotent RELEASED / EXPIRED / CANCELLED messages with latency and delivery metrics.

### P5 — Statistical calibration

Add confidence intervals, effective sample size and reliability/calibration charts. Do not publish "assertiveness" from raw win rate.

## North-star diagnostic principle

WILL should optimize for **decision quality per independent evidence sample**, not number of signals.

The machine is healthy when it can explain:

- why a study was admitted or rejected;
- why it waited;
- why a candidate was released;
- whether the operator actually executed it;
- what happened afterward;
- which features/context were present at decision time;
- whether the same result survives out-of-sample validation.
