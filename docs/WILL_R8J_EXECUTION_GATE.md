# WILL R8J controlled temporal-semantics gate

Status: PREPARED, NOT AUTHORIZED FOR EXTERNAL EXECUTION.

R8J exists to observe whether Twelve Data WebSocket quotes can show continuing receive-time activity while the provider-native timestamp repeats within coarse buckets. It does not reinterpret or relax the frozen 30,000 ms freshness contract.

## Scope

- Symbol: EUR/USD only.
- WebSocket connections: at most 1.
- Subscribe attempts: at most 1.
- Observation window: 60,000 ms.
- Pre-accept timeout: 5,000 ms.
- Heartbeat interval: at least 10,000 ms.
- Retries: 0.
- Reconnects: 0.
- Redirects: 0.
- REST requests: 0.
- Saxo requests: 0.
- Avalon requests: 0.
- PAPER authorization: false.
- Orders: 0.

## Authorization

External R8J execution requires all three runtime conditions:

- `WILL_TWELVE_R8J_ENABLED=true`
- `WILL_TWELVE_R8J_AUTHORIZATION=R8J_TEMPORAL_SEMANTICS_EXPLICITLY_AUTHORIZED`
- `TWELVEDATA_API_KEY` present locally

Historical R8H/R8I authorization strings are rejected.

## Sanitized evidence

The R8J observer may return aggregate temporal diagnostics only: counts, positive step minima/maxima, regressions, repeated-native-timestamp counts, and classification. Raw native timestamps, raw receive timestamps, prices, API keys, or quote payloads are not part of the report contract.

The arrival/native diagnostic is descriptive only. Its result cannot commission a provider, authorize PAPER, influence a trading decision, or execute an order.

## Frozen freshness semantics

The nested freshness evidence must continue to report `freshnessContractMs = 30000`. A changed value causes the R8J wrapper to fail closed. Arrival cadence is not substituted for provider-native event freshness.

## Execution state

This document prepares the gate only. No external provider call is authorized by this commit or by repository state. A future R8J one-shot requires a new explicit user authorization after tests and CI are green.
