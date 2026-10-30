# WILL — Cross-Provider Composition Qualification

## Decision

**Phase:** 20C.6.12  
**Result:** `COMPOSABLE_OFFLINE`  
**Contract:** `saxo-closed-ohlc-independent-quote-v1`  
**Composition:** Saxo OpenAPI Charts closed M1 OHLC + Twelve Data WebSocket native quote timestamp  
**Mode:** PAPER/MANUAL; offline fixtures only; no decision impact

The two sources are independently sufficient for their assigned evidence role in controlled offline fixtures. This does not qualify either source for the other role and does not authorize prospective collection or decisions.

## Evidence ownership

| Evidence | Sole authority | Accepted field/origin | Forbidden substitutions |
|---|---|---|---|
| Quote price and freshness | Twelve Data WebSocket | price tick plus provider-native `timestamp`; origin `twelvedata.websocket.price.timestamp` | WS `receivedAt`, Saxo `Time`, Saxo receive time, cache time, wall clock as replacement timestamp |
| Closed M1 OHLC | Saxo OpenAPI Charts | only samples already classified by the documented initial-subscription or closed+opened update rules; `Data[].Time` | quote-provider fields, array position, elapsed time, candle spacing |

The composition never merges OHLC. Every candle and `latestClosedCandleTimestamp` comes from one Saxo snapshot. The quote provider cannot set completeness. `quoteTimestamp` comes only from the Twelve event timestamp, while `receivedAt` is retained as non-authoritative transport provenance.

## Deterministic gate

Composition is `COMPOSABLE_OFFLINE` only when:

- canonical symbol is exactly `EUR/USD` at both sources;
- timeframe is exactly `1min`, Saxo Horizon is `1`, and Saxo provider identity is exact;
- Saxo carries `VERIFIED_CLOSED_BY_DOCUMENTED_CHART_CONTEXT`, an allowlisted completeness rule, valid closed timestamp, numeric OHLC, and timestamp provenance;
- Twelve WS health is `SHADOW_OBSERVABILITY`, connected, accepted without rejected subscription, and contains a positive-price EUR/USD tick;
- the native event timestamp is valid, not over 1 second in the future, and no older than the frozen 30,000 ms gate;
- each timestamp origin and provider role remains explicit.

Missing/stale/invalid quote, ambiguous Saxo completeness, source/symbol/timeframe mismatch, malformed OHLC, or insufficient provenance produces `INVALID`. A fresh receive time never reduces native quote age.

## Qualification-only boundary

Even a successful composition returns `valid:false`, `status:OFFLINE_QUALIFIED`, `decisionImpact:NONE`, and `prospectivePaperAuthorized:false`. Consequently the unchanged `multi-provider-ohlc-resilience-v1` rejects it. Promotion would require a separate authorization, live entitlement validation, operational error/reconnect evidence, and a deliberate contract decision; none is implied here.

No HTTP/WebSocket call, login, account, token, app, commissioning, prospective batch, 20C.6 authorization, Champion/threshold/ranking/calibration change, execution action, or merge occurred.

