# WILL — Tiingo FX Offline Qualification

## Decision

**Fase:** 20C.6.9 — Secondary Provider Qualification #2: Tiingo FX  
**Result:** `QUALIFIED_OFFLINE_WITH_LIMITATIONS`  
**Mode:** PAPER/MANUAL; qualification offline only  
**Contract:** `tiingo-fx-offline-qualification-v1`, compatible fail-closed with `multi-provider-ohlc-resilience-v1`

Tiingo is qualified only as an offline payload and contract candidate. It is not qualified as a `VERIFIED_CLOSED` OHLC fallback because the official FX REST documentation inspected does not expose or define candle-completeness evidence. The same material shows examples for `5min` and `1day`, but does not explicitly establish `resampleFreq=1min`. Both gaps remain external and must not be inferred.

## Official evidence matrix

| Question | Official evidence | Finding |
|---|---|---|
| EUR/USD ticker | [Symbology](https://www.tiingo.com/documentation/appendix/symbology) says FX symbols remove `/` and explicitly maps EUR/USD to EURUSD. | `EUR/USD -> EURUSD`, exact and allowlisted; no heuristic mapping. |
| `resampleFreq=1min` | [Forex REST](https://www.tiingo.com/documentation/forex) documents the prices endpoint and examples for `5min` and `1day`. | `UNVERIFIED_IN_OFFICIAL_DOCUMENTATION`; no live probe was made. |
| REST top-of-book | [Forex REST](https://www.tiingo.com/documentation/forex) defines `quoteTimestamp`, `bidPrice`, `askPrice`, and `midPrice`; midpoint is the mean of bid and ask when both exist. | Structurally qualified offline with timestamp preserved. |
| REST intraday OHLC | [Forex REST](https://www.tiingo.com/documentation/forex) defines `date`, `open`, `high`, `low`, `close` and `ticker`. | Structurally qualified offline; response order is not trusted and is normalized by original `date`. |
| Closed candle | No explicit closed/complete field or closure guarantee was found in the official FX REST contract. | `UNVERIFIED_BY_PROVIDER_PAYLOAD`; `latestClosedCandleTimestamp=null`; fail closed for `VERIFIED_CLOSED`. |
| FX WebSocket | [Forex WebSocket](https://www.tiingo.com/documentation/websockets/forex) defines `wss://api.tiingo.com/fx`, service `fx`, top-of-book updates, and array index 2 as the ISO time the quote arrived. | Timestamp provenance is `tiingo.fx.websocket.data[2]`; WebSocket remains SHADOW and is not OHLC evidence. |
| Authentication | [Connecting](https://www.tiingo.com/documentation/general/connecting) documents `Authorization: Token <token>` for REST and `authToken` in WebSocket subscription messages. | Token required; none obtained, stored, logged or used. |
| Rate limits | [General](https://www.tiingo.com/documentation/general) states hourly request, daily request, and monthly bandwidth limits; daily resets at midnight EST and bandwidth monthly. | Exact quotas are plan-dependent and not frozen from marketing copy. Local classification: 401/403 `MISCONFIGURED`, 429 `RATE_LIMITED`, network/5xx/unknown `UNAVAILABLE`. This taxonomy is conservative integration policy, not a claimed exhaustive Tiingo contract. |
| Free/personal/commercial license | [General](https://www.tiingo.com/documentation/general) says Basic/Power are internal personal use with no redistribution; Commercial supports internal commercial use without redistribution. [Developer Program](https://www.tiingo.com/documentation/appendix/developers) requires each user to have their own account/token and requires a separate redistribution license. | Free/personal evidence cannot authorize future commercial or redistributed operation. Commercial and redistribution terms require the appropriate plan/license and review. |

The Forex REST and WebSocket APIs are labelled beta in Tiingo's documentation. WebSocket firehose access is described for Free, Power, Commercial and Redistribution plans, but this does not override usage/license limits.

## Offline adapter behavior

`transformTiingoFxOffline` performs no I/O and accepts only supplied fixtures. It:

- requires the explicit canonical/provider mapping `EUR/USD -> EURUSD`;
- accepts only the requested WILL shape `1min/resampleFreq=1min`, while labelling official support unverified;
- preserves `quoteTimestamp`, candle `date`, and local `providerReceivedAt` independently;
- computes freshness only from the provider `quoteTimestamp` against the frozen 30,000 ms gate;
- validates bid/ask/midpoint, OHLC values/ranges, identity and timestamps;
- orders candles deterministically by their original provider timestamps;
- ignores non-contractual `complete` or `closed` fixture fields;
- always rejects an otherwise fresh snapshot with `CANDLE_COMPLETENESS_UNVERIFIED` until provider evidence can establish a closed candle.

This invalid status means `multi-provider-ohlc-resilience-v1` rejects the Tiingo snapshot rather than treating observational OHLC as authoritative fallback data.

## Error and safety boundaries

No account was created, no token was requested, and no REST or WebSocket call was made. There is no provider client, commissioning script, environment variable or secret-bearing configuration in this phase. The classifier is deliberately fail-closed and does not retry, wait, or consume quota.

Frozen invariants remain unchanged: PAPER/MANUAL, 30,000 ms Data Quality Gate, original provider timestamps, Champion/strategy/thresholds/contracts, no batch, no 20C.6, no commissioning, and no merge.

## Exit criteria for a later phase

Before Tiingo can become a live secondary OHLC provider, official evidence or bounded external commissioning must independently prove:

1. that the account/endpoint actually supports `resampleFreq=1min`;
2. how the latest bar is identified as closed/complete without local time inference;
3. applicable quota for the intended plan;
4. licensing for the intended commercial and/or redistribution model.

Until then the only permitted conclusion is `QUALIFIED_OFFLINE_WITH_LIMITATIONS`.

