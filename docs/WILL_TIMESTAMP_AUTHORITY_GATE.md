# WILL — Timestamp Authority Gate

Status: OFFLINE SAFETY LAYER. NO EXTERNAL PROVIDER CALL AUTHORIZED OR REQUIRED.

## Purpose
Separate timestamp semantics from transport activity and trading authority. The gate prevents WILL from treating repeated WebSocket arrivals, provider bucket timestamps, or client receive time as equivalent to a verified market event timestamp.

## Authority classes
- `EXCHANGE_EVENT_TIME`: timestamp proven to originate from the underlying exchange/venue event.
- `PROVIDER_EVENT_TIME`: timestamp proven by provider semantics to represent the provider's event time and comparable to the receive clock.
- `PROVIDER_BUCKET_TIME`: coarse/bucketed timestamp such as a repeated minute boundary; descriptive only.
- `CLIENT_RECEIVE_TIME`: local arrival time; transport diagnostic only.
- `UNRESOLVED`: evidence does not establish authority.

## Frozen invariants
- freshness contract remains exactly 30,000 ms.
- arrival time cannot replace event time.
- bucket time cannot bypass freshness.
- timestamp classification cannot commission a provider.
- timestamp classification cannot authorize PAPER or live execution.
- decisionImpact remains `NONE`.
- ordersExecuted remains `0`.

## Evidence rule
`EXCHANGE_EVENT_TIME` or `PROVIDER_EVENT_TIME` can be marked supported only when provenance is verified and the timestamp is demonstrably comparable to the receive clock. Even then, the result only permits evaluation against the existing frozen freshness contract; it grants no trading authority.

## R8K relationship
The consumed R8K attempt remains `INCONCLUSIVE`; this offline layer does not reinterpret it, recover missing evidence, or authorize another external call. Observed minute-bucket behavior from earlier bounded observations remains descriptive evidence only.
