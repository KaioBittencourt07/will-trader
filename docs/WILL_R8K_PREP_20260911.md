# WILL R8K-PREP — Twelve WebSocket Freshness Semantics

Date: 2026-09-11
Status: OFFLINE / FAIL-CLOSED

## Question
Which Twelve WebSocket timestamp, if any, is semantically justified as the event-time authority for the frozen 30,000 ms freshness contract?

## Existing evidence
R8J observed a live, bounded EUR/USD WebSocket window with active quote arrivals while the provider-native timestamp repeated inside two buckets and advanced once by exactly 60,000 ms. That supports a minute-bucket pattern for the observed window; it does not prove universal provider semantics.

## Provider documentation reviewed
Current Twelve Data support documentation describes `/v1/quotes/price` WebSocket `price` events as real-time tick prices and states that the message includes a UNIX timestamp and price. Current Twelve Data latency guidance says WebSocket ticks can have delay up to roughly 170 ms depending on instrument.

Those statements do not explicitly define the `timestamp` field as a unique per-tick exchange/event timestamp, nor do they explain the minute-bucket behavior observed in R8J. Therefore they are insufficient to reinterpret the field or to replace the frozen freshness authority.

## R8K-PREP decision
`FRESHNESS_SEMANTICS_UNVERIFIED` remains the correct fail-closed state unless explicit provider evidence establishes that the WebSocket timestamp is per-tick event time.

Frozen invariants:
- freshness contract remains 30,000 ms;
- arrival/receive time is transport-cadence evidence only and cannot replace event time;
- minute-bucket semantics cannot bypass freshness;
- no provider commissioning;
- no PAPER authorization;
- no decision impact;
- zero orders;
- no external provider observation is authorized by this prep.

## Implementation
`backend/src/twelveWsFreshnessSemanticReadiness.js` encodes the evidence gate. It requires explicit per-tick event-time semantics before returning `PER_TICK_EVENT_TIME_SEMANTICS_SUPPORTED`; generic UNIX-timestamp and real-time-tick documentation is intentionally insufficient.

## Next evidence path
Prefer provider documentation/support clarification or another independently documented field before any new external observation. A future network observation requires a separate bounded gate and explicit authorization.
