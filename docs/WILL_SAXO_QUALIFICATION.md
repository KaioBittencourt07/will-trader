# WILL — Saxo OpenAPI Charts Offline Qualification

## Decision

**Phase:** 20C.6.11 — Provider Qualification #4  
**Result:** `QUALIFIED_OFFLINE_WITH_LIMITATIONS`  
**Contract:** `saxo-openapi-charts-offline-qualification-v1`  
**Mode:** PAPER/MANUAL; default OFF; offline only

Saxo Charts provides provider-documented contexts for identifying completed samples, unlike the previously inspected payloads. It does not provide an independent quote timestamp appropriate for WILL's freshness gate. The chart candidate therefore remains invalid for `multi-provider-ohlc-resilience-v1` until an independently timestamped quote source is separately qualified.

## Official evidence

| Topic | Official Saxo evidence | Finding |
|---|---|---|
| Instrument identity | [Pricing guide](https://www.developer.saxo/openapi/learn/pricing) identifies EURUSD as UIC `21`, `FxSpot`. | Exact allowlist: canonical `EUR/USD`, provider symbol `EURUSD`, UIC `21`, AssetType `FxSpot`; no invented UIC. |
| M1 | [GET chart v3](https://www.developer.saxo/openapi/referencedocs/chart/v3/charts/get__chart) defines Horizon in minutes and includes `1`. | WILL `1min -> Horizon=1`. |
| OHLC | GET chart returns timestamped `ChartSample` data; Forex returns Bid and Ask values. Chart samples expose `Open/High/Low/Close` and `Time`. | Offline transformer preserves documented OHLC and `Time`. |
| Initial subscription snapshot | [Chart v3 overview](https://www.developer.saxo/openapi/referencedocs/chart/v3/charts) says subscription creation returns the most recently completed samples. | All samples in an explicitly identified initial subscription snapshot are closed by provider-documented context. |
| Streaming close transition | The same page says when a sample closes the update typically contains the now-closed bar and the bar just opening. [Chart guide](https://www.developer.saxo/openapi/learn/chart) explains a sample is updated until completed and then a new one starts. | Only a same update explicitly containing two distinct samples under this event context allows the older sample to be classified closed; the newer is current. A single update is ambiguous and fails closed. |
| REST GET/current sample | Chart guide says the newest sample is updated until completed. The REST payload has no per-sample completion flag. | Array position, timestamp distance and wall clock cannot prove closure; generic REST GET fails closed. |
| DataVersion/corrections | Chart guide says DataVersion changes require invalidating/refetching data; streaming can issue reset subscription. | DataVersion is mandatory provenance, not proof of closure or freshness. |
| ChartInfo | [ChartInfo](https://www.developer.saxo/openapi/referencedocs/chart/v3/charts/post__chart__subscriptions/schema-chartinfo) defines `FirstSampleTime`, `Horizon`, `ExchangeId`, and optional `DelayedByMinutes`. | Fields are preserved; delay is a limitation and does not alter timestamps. |
| Quote freshness | Chart guide explicitly says chart close should not be used for the most accurate/up-to-date price and directs clients to Trade `/InfoPrices` or `/Prices`. | Chart `Time` cannot silently replace quote time. Output is `QUOTE_FRESHNESS_UNVERIFIED`, with no quote age. |
| Errors/auth | GET chart documents 401 missing/invalid authorization, 429 rate limit, and 503 unavailable. | 401/403 `MISCONFIGURED`, 429 `RATE_LIMITED`, remaining failures `UNAVAILABLE`. No token was obtained or used. |
| Access | Public docs expose sim/live URLs, but operational/account availability and Brazilian user eligibility are not established. | `EXTERNAL_UNVERIFIED`; no account, app, login, token or request attempted. |

## Exact closed-sample rule

1. `SUBSCRIPTION_INITIAL_SNAPSHOT`: every `Data[]` item is accepted as closed because Saxo explicitly calls the initial snapshot “most recently completed samples”. Items are sorted by their provider `Time`, never trusted by array position.
2. `STREAM_UPDATE_CLOSED_AND_OPENED`: require exactly two distinct timestamped samples delivered in the same documented transition. The older is the now-closed sample; the newer is retained separately as current and never enters `candles` or `latestClosedCandleTimestamp`.
3. Any REST GET, one-sample update, caller label outside these contexts, missing timestamp, or malformed evidence returns a completeness error. Neither local time nor spacing between samples is consulted.

Even when closed-sample status is verified, the transformer returns `INVALID / QUOTE_FRESHNESS_UNVERIFIED`, because Charts does not carry the independent quote timestamp required by the frozen `rest-quote-freshness-v1` contract. The gate remains exactly 30,000 ms and is not weakened or evaluated against candle/receive time.

## Safety boundary

The transformer accepts fixtures only and contains no HTTP, streaming, authentication, account or commissioning logic. It changes no shared provider, Champion, strategy, threshold, ranking or decision contract. No provider consumption, account creation, token request, live/sim call, batch, 20C.6 authorization or merge occurred.

