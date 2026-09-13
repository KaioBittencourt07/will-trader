# WILL WS Freshness + REST OHLC Composition

Contract: `ws-freshness-rest-ohlc-composition-v1`

This phase introduces an isolated, fail-closed SHADOW composer. Twelve WebSocket supplies freshness evidence only; the existing Twelve REST snapshot remains the sole source of OHLC, history, features and authoritative decision status. The composer consumes already available snapshots, opens no connection, performs no REST request and has `decisionImpact: NONE`.

| REST quote | REST OHLC | WS tick | SHADOW result | Decision authority |
| --- | --- | --- | --- | --- |
| fresh | available | fresh | `COMPOSABLE` | unchanged REST gate |
| stale | available | fresh | `COMPOSABLE` + `REST_QUOTE_STALE_SHADOW_ONLY` | remains `STALE_MARKET_DATA` |
| any | missing/invalid | any | `NOT_COMPOSABLE` | unchanged, fail closed |
| any | available | stale/disconnected/rejected/missing | `NOT_COMPOSABLE` | unchanged, fail closed |
| provenance/provider cannot be established | any | any | `UNKNOWN` | unchanged, fail closed |

The output keeps REST and WS provider, symbol, timestamps and ages independent. Price divergence is reported as signed/absolute price units, relative fraction and basis points (`WS_LAST_TICK_MINUS_REST_QUOTE`). It never replaces the REST price. Candle completeness remains `OBSERVATIONAL_UNVERIFIED` when Twelve's payload does not prove a closed candle; consumers requiring verified closure receive `NOT_COMPOSABLE`.

`COMPOSABLE` is an observability finding only. It never authorizes BUY/SELL, bypasses freshness, changes Champion, strategy, thresholds, scanner, ranking or starts prospective collection.
