# WILL R8J — Controlled Temporal Semantics Observation — 2026-09-11

## Authorization
- Explicit user authorization: `AUTORIZO R8J CONTROLADO`.
- Authorization scope: one bounded Twelve Data WebSocket temporal-semantics observation only.
- This authorization is consumed by the observation recorded below because `externalProviderCalls = 1`.
- It does not authorize PAPER, provider commissioning, Avalon access, broker execution, live orders, retries, reconnects, REST calls, Saxo calls, threshold changes, or a second R8J run.

## Frozen contract
- Freshness contract remains exactly `30_000 ms`.
- No threshold recalibration is authorized by this result.
- Arrival cadence, provider-native timestamp progression, freshness, and quote frequency remain separate dimensions.

## Bounded execution result
- executionVersion: `twelve-r8j-execution-v1`
- result: `OBSERVED`
- connections: `1`
- subscribeAttempts: `1`
- subscribeAccepted: `true`
- observationWindowMs: `60_000`
- preAcceptTimeoutMs: `5_000`
- heartbeatIntervalMs: `10_000`
- retries: `0`
- reconnects: `0`
- redirects: `0`
- restRequests: `0`
- saxoRequests: `0`
- externalProviderCalls: `1`
- ordersExecuted: `0`
- providerCommissioning: `false`
- prospectivePaperAuthorized: `false`
- decisionImpact: `NONE`
- secretExposed: `false`

## Quote / freshness evidence
- quoteMessagesObserved: `29`
- freshnessSamplesObserved: `29`
- freshnessPassCount: `13`
- freshnessFailCount: `16`
- freshnessInvalidCount: `0`
- freshnessUnverifiedCount: `0`
- minEventAgeMs: `3_883`
- maxEventAgeMs: `61_515`
- lastEventAgeMs: `22_097`
- classification: `FRESHNESS_CONTRACT_FAILED`
- representative blocker: `EVENT_OLDER_THAN_FROZEN_CONTRACT`

Interpretation: the bounded window contains both observations younger and older than the frozen 30-second contract. The existence of active quote arrival does not override the freshness failure of provider-native timestamps.

## Provider-native timestamp evidence
- timestampSamplesObserved: `29`
- validTimestampSamplesObserved: `29`
- invalidTimestampCount: `0`
- distinctNativeEventTimestampCount: `2`
- repeatedTimestampQuoteCount: `27`
- timestampAdvanceCount: `1`
- timestampRegressionCount: `0`
- minPositiveTimestampStepMs: `60_000`
- maxPositiveTimestampStepMs: `60_000`
- maxQuotesSharingNativeTimestamp: `19`
- timestampProgressionClassification: `REPEATED_TIMESTAMP_PATTERN_OBSERVED`

Interpretation: in this bounded R8J window, the observed provider-native timestamp behaved like a coarse/bucketed timestamp: many quote messages shared the same native timestamp and the only positive native advance observed was exactly 60 seconds. This is evidence for this window, not a universal statement about all Twelve Data semantics.

## Arrival/native diagnostic
- samplesObserved: `29`
- validSamplesObserved: `29`
- invalidSampleCount: `0`
- distinctNativeTimestampCount: `2`
- repeatedNativeTimestampQuoteCount: `27`
- maxQuotesPerNativeTimestamp: `19`
- nativeAdvanceCount: `1`
- nativeRegressionCount: `0`
- arrivalAdvanceCount: `28`
- arrivalRegressionCount: `0`
- minPositiveNativeStepMs: `60_000`
- maxPositiveNativeStepMs: `60_000`
- minPositiveArrivalStepMs: `761`
- maxPositiveArrivalStepMs: `4_310`
- classification: `NATIVE_BUCKETING_WITH_ARRIVAL_ACTIVITY`
- freshnessInterpretation: `NOT_EVALUATED`
- rawTimestampsExposed: `false`

Interpretation: all 28 consecutive arrival transitions advanced while only one provider-native timestamp transition advanced. This supports the R8J hypothesis that quote transport/arrival activity can continue inside a repeated native timestamp bucket. Arrival continuity therefore must not be used as a substitute for provider-native event freshness.

## Decision
R8J successfully clarified temporal semantics but does **not** commission Twelve Data for the frozen freshness contract.

Current state remains:
- `providerCommissioning = false`
- `prospectivePaperAuthorized = false`
- `ordersExecuted = 0`
- `decisionImpact = NONE`
- frozen freshness contract = `30_000 ms`

## Next safe step
Use this result offline to formalize a provider timestamp-semantics adapter / evidence classification that preserves both facts simultaneously:
1. transport arrivals are active and progressive;
2. provider-native event timestamps may be bucketed at 60-second boundaries and can still fail the frozen 30-second freshness gate.

Do not rerun R8J or perform another external provider observation without a separately justified and explicitly authorized gate.
