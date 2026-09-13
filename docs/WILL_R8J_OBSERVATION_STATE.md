# WILL TRADER — R8J Observation State Separation

## Purpose
Represent the R8J evidence without conflating transport activity, provider-native timestamp semantics, or the frozen freshness contract.

## Canonical state
For the controlled R8J observation on 2026-09-11, the intended classification is:

`TRANSPORT_ACTIVE_NATIVE_BUCKETED_FRESHNESS_FAILED`

This means all three statements are simultaneously true and independent:

1. **Transport active** — one WebSocket connection and one accepted subscription delivered quotes during the bounded window.
2. **Native timestamp bucket pattern supported** — multiple quote arrivals shared the same provider-native timestamp and the observed positive native timestamp step was exactly 60,000 ms.
3. **Freshness failed** — at least one quote exceeded the frozen 30,000 ms freshness contract.

## Non-equivalences
The following implications are explicitly forbidden:

- transport active != fresh market data;
- repeated quote arrivals != new provider-native event time;
- minute bucket pattern != permission to reinterpret arrival time as event time;
- freshness PASS != provider commissioning;
- freshness PASS != PAPER authorization;
- descriptive timestamp semantics != trading authority.

## Frozen invariants
- `freshnessContractMs = 30000`;
- arrival time remains `TRANSPORT_CADENCE_DIAGNOSTIC_ONLY`;
- provider-native timestamp remains temporal evidence only;
- `providerCommissioning = false`;
- `decisionImpact = NONE`;
- `prospectivePaperAuthorized = false`;
- `ordersExecuted = 0`.

Any input that attempts to alter these authority invariants, expose raw timestamps through this state layer, or substitute a different freshness contract is classified fail-closed as `DATA_INVALID`.

## Implementation
- `backend/src/twelveWsObservationState.js`
- `tests/twelveWsObservationState.test.js`

This layer is pure/offline. It performs no provider calls and consumes no external authorization.
