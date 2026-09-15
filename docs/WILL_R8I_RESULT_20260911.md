# WILL — R8I Controlled Observation Result — 2026-09-11

## Status

`R8I_CONTROLLED_OBSERVATION_CONSUMED`

This document records the single externally authorized R8I observation performed against the Twelve Data WebSocket. It does not authorize provider commissioning, PAPER, live execution, Avalon interaction, threshold changes, or any order.

## Executed envelope

- execution version: `twelve-r8i-execution-v1`
- connections: 1
- subscribe attempts: 1
- symbol: EUR/USD
- observation window: 60,000 ms
- pre-accept timeout: 5,000 ms
- heartbeat interval: 10,000 ms
- retries: 0
- reconnects: 0
- redirects: 0
- REST requests: 0
- Saxo requests: 0
- Avalon requests: 0
- external provider calls: 1
- orders executed: 0
- secret exposed: false

## Observed evidence

Freshness:

- quote messages observed: 27
- freshness samples observed: 27
- PASS: 12
- FAIL: 15
- DATA_INVALID: 0
- UNVERIFIED: 0
- minimum event age: 3,706 ms
- maximum event age: 60,096 ms
- last event age: 36,844 ms
- frozen freshness contract: 30,000 ms
- classification: `FRESHNESS_CONTRACT_FAILED`
- representative blocker: `EVENT_OLDER_THAN_FROZEN_CONTRACT`

Native timestamp progression:

- timestamp samples observed: 27
- valid timestamp samples: 27
- invalid timestamps: 0
- distinct native timestamps: 2
- repeated-timestamp quotes: 25
- timestamp advances: 1
- timestamp regressions: 0
- minimum positive native step: 60,000 ms
- maximum positive native step: 60,000 ms
- maximum quotes sharing one native timestamp: 15
- classification: `REPEATED_TIMESTAMP_PATTERN_OBSERVED`

## Interpretation boundary

The observation provides evidence that quote arrival activity can occur multiple times while the provider-native event timestamp remains repeated, with one observed native advance of exactly 60 seconds. This is descriptive evidence only. It does not prove a universal provider timestamp semantic, does not prove transport unreliability, and does not justify replacing provider-native event time with receive time for the frozen freshness contract.

Freshness, quote arrival continuity, native timestamp progression, and quote frequency remain separate dimensions. The 30,000 ms freshness contract remains frozen and was not recalibrated to fit this observation.

## Decision

- providerCommissioning: false
- prospectivePaperAuthorized: false
- decisionImpact: `NONE`
- ordersExecuted: 0
- Twelve remains not commissioned under the current contract.

## Next offline gate

A pure diagnostic `twelve-ws-arrival-native-diagnostic-v1` is prepared to compare provider-native timestamp progression against receive/arrival progression using synthetic or already-captured pairs only. It performs zero network calls and returns no raw timestamps.

The R8I observer did not persist the 27 raw native/receive timestamp pairs. Therefore this historical R8I run cannot be retrospectively reconstructed at per-quote resolution. Any future real per-quote collection would require a separate bounded authorization and should not be inferred from these aggregates.
