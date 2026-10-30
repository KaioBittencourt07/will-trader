# WILL Provider Readiness and Rate-Limit Resilience

Contract: `provider-readiness-v1`

The central `MarketDataEngine` owns REST readiness. Its local status has five conservative states:

| State | Meaning | Provider request allowed |
| --- | --- | --- |
| `READY` | no active cooldown; a request may be attempted | yes |
| `COOLDOWN` | a prior 429 opened a bounded cooldown | no |
| `RATE_LIMITED` | cause recorded at the 429 event (legacy metric state) | no immediate retry |
| `UNAVAILABLE` | network/provider failure | fail closed |
| `MISCONFIGURED` | credential/configuration failure | fail closed |

An HTTP 429 is never handled by the generic retry loop. It opens one centralized cooldown using `Retry-After`, a recognized reset header, or the deterministic local default of 60 seconds when the provider supplies neither. The safety cap is 15 minutes. New misses re-check readiness before and after limiter waiting and fail with `PROVIDER_COOLDOWN`; cache hits remain available but retain their original provider timestamps and are revalidated by `rest-quote-freshness-v1`.

`GET /api/market/status` reports readiness and the existing WS health without a REST request. Request/cycle telemetry adds `blockedByCooldown` and `rateLimitEvents` alongside `externalRequests`, cache hits/misses, deduplication, limiter wait, latency and estimated credits. Credit counts remain estimates, never official quota. REST provider operations and WS connection/tick counters remain separate.

WS composition remains `SHADOW` with `decisionImpact: NONE`. A fresh WS tick cannot mask missing or rate-limited REST, cannot create OHLC and cannot authorize BUY/SELL.

## Future re-commissioning gate

A new live attempt requires separate authorization after tests and CI are green. Before connecting, inspect `/api/market/status` locally and require `providerReadiness.state === READY`, zero remaining cooldown, a configured credential and the existing single central WS connection. Run one 30–60 second EUR/USD SHADOW window only; do not poll quota, retry for a favorable result or start a prospective batch. Record REST/WS consumption separately and stop on any 429 or external limitation.
