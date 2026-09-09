# WILL — Massive Currencies Offline Qualification

## Decision

**Phase:** 20C.6.10 — Provider Qualification #3  
**Result:** `QUALIFIED_OFFLINE_WITH_LIMITATIONS`  
**Contract:** `massive-fx-offline-qualification-v1`  
**Mode:** PAPER/MANUAL; default OFF; zero HTTP/WebSocket

Massive has documented one-minute FX aggregates, provider-native quote timestamps, and useful temporal provenance. It is not qualified for `VERIFIED_CLOSED`: the inspected official documentation defines aggregate window start/end fields but does not promise that a returned/emitted bar is finalized, immutable, or no longer subject to updates.

## Official evidence

| Topic | Official evidence | Qualification |
|---|---|---|
| REST aggregate symbol | [Custom Bars](https://massive.com/docs/rest/forex/aggregates) uses `C:EURUSD`. | Exact mapping for `/v2/aggs/ticker/...`: `EUR/USD -> C:EURUSD`. |
| Historical quote symbol | [Historical Quotes](https://massive.com/docs/rest/forex/quotes/quotes) uses `C:EUR-USD`. | Separate exact mapping for `/v3/quotes/...`; never substituted for the aggregate ticker. |
| Last quote | [Last Quote](https://massive.com/docs/rest/forex/quotes/last-quote) uses path components `{from}/{to}`, returns `symbol` such as `EUR/USD`, bid/ask and Unix-ms `timestamp`. | Quote freshness can be evaluated independently from bar adequacy. |
| REST M1/OHLC | Custom Bars exposes multiplier/timespan and OHLC `o/h/l/c`; `t` is the Unix-ms start of the aggregate window. FX bars derive from quoted bid/ask prices rather than trades. A window without new quotes produces no bar. | `multiplier=1`, `timespan=minute`; gaps remain missing evidence, never synthetic bars. |
| WebSocket M1 | [Minute Aggregates](https://massive.com/docs/websocket/forex/aggregates-per-minute) documents event `CA`, minute-by-minute OHLC from BBO quotes, pair subscription format `{from}-{to}`, response `pair`, start `s`, and end `e` in Unix ms. No new quote means no emitted bar. | Subscription allowlist `EUR-USD`; payload identity `EUR/USD`; WS remains non-authoritative. |
| Candle closed/finalized | The docs call `s` and `e` window start/end and say aggregates update continuously. No inspected statement guarantees finalized/immutable bars. REST provides only start `t`. | `e` and elapsed wall time are not closure proof. `UNVERIFIED_BY_PROVIDER_PAYLOAD`, `latestClosedCandleTimestamp=null`, fail closed. |
| Historical BBO timestamp | Historical Quotes defines `participant_timestamp` as nanosecond exchange Unix time when the quote was generated. | Documented provenance only; the offline adapter uses the last-quote Unix-ms timestamp for the frozen freshness gate. |
| Snapshot | [Single Ticker Snapshot](https://massive.com/docs/rest/forex/snapshots) documents `lastQuote` and `min`, the most recent minute bar. | Useful separation exists, but snapshot recency/entitlement and bar finalization must not be presumed. |
| Authentication | [REST Quickstart](https://massive.com/docs/rest/quickstart) requires an API key via `apiKey` query parameter or `Authorization: Bearer ...`; WebSocket uses an auth message. | No key/account/login was requested or used. Headers are preferable for any future separately authorized work. |
| Plans/quotas | [Currencies Pricing](https://massive.com/pricing?product=currencies) lists Basic Free at 5 API calls/minute, two years history, EOD data and minute aggregates; Starter lists unlimited API calls, 10+ years, real-time, WebSockets, Snapshot, quotes and second aggregates. | Basic does not establish real-time quote/snapshot/WS entitlement. Starter is individual use. Business use requires a business plan and legal review. |
| WS entitlement | Minute Aggregates lists Basic as not included and Starter as real-time. Historical Quotes likewise lists Basic not included and Starter real-time/all history. | Offline documentation qualification does not imply entitlement. |

Pricing and licensing are time-sensitive product terms. This record captures the official pages inspected for the phase, not a perpetual commercial license. Any future business, display, redistribution, derived-data, or automated-trading use requires the applicable business agreement and legal review.

## Offline transformer

`transformMassiveFxOffline` accepts supplied fixtures only. It has no network client, key configuration, retry loop, account flow, or commissioning capability. It validates exact endpoint-specific mappings, exact M1 request semantics, response identity, bid/ask, numeric OHLC/range invariants, no-bar/no-quote gaps, provider timestamps, and deterministic ordering.

Freshness remains exactly `rest-quote-freshness-v1` with a 30,000 ms threshold and is calculated solely from `last.timestamp`. `providerReceivedAt`, REST bar `t`, WebSocket `s/e`, and elapsed window time cannot replace or rejuvenate that quote timestamp.

Even with structurally valid, fresh fixtures, output is `INVALID / CANDLE_COMPLETENESS_UNVERIFIED`. This is intentionally compatible with `multi-provider-ohlc-resilience-v1`: the unchanged frozen layer rejects it rather than weakening its gate.

## Remaining gates

Before any future live qualification, independent authorization and evidence are required for account entitlement, recency, exact operational quotas, and provider-native finalized/immutable candle semantics. Until those are proven, the result remains `QUALIFIED_OFFLINE_WITH_LIMITATIONS`.

No live call, account creation, API key request, login, billing, commissioning, prospective batch, 20C.6 authorization, strategy change, execution capability, or merge occurred.

