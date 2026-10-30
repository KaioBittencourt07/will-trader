# OANDA Secondary OHLC Qualification

Qualification contract: `secondary-provider-qualification-v1`  
Offline adapter: `oanda-rest-v20-offline-adapter-v1`  
Result: `QUALIFIED_OFFLINE`; live eligibility: `EXTERNAL_UNVERIFIED`; default: OFF.

Official REST-v20 semantics audited offline:

- WILL `EUR/USD` maps explicitly to OANDA `EUR_USD`; `1min` maps to `M1`.
- Candles expose start `time`, numeric string OHLC for requested `M` (mid), `B` (bid), and/or `A` (ask), volume, and explicit `complete`. Count defaults to 500 and is capped at 5000; count must not be combined with both from/to.
- This qualification fixes candle component to `M`. Quote freshness is independently sourced from pricing `prices[].time`; price is the midpoint of explicit `closeoutBid` and `closeoutAsk`. Candle time is never substituted for quote time, and local `providerReceivedAt` never rejuvenates either.
- Only `complete === true` candles can become OHLC evidence. The latest complete candle remains separately identified and `candleCompleteness` is `VERIFIED_CLOSED`.
- Live REST requires a Bearer token and eligible OANDA account/account ID. 401/403 map to `MISCONFIGURED`, 429 to `RATE_LIMITED`, and 5xx/network to `UNAVAILABLE`.
- OANDA recommends at most 2 new connections/s and 100 requests/s on a persistent connection; these are external limits, not permission to commission or retry.

The pure transformer performs no HTTP and has no token/account input. It produces `rest-quote-freshness-v1` snapshots compatible with the unchanged `multi-provider-ohlc-resilience-v1`, including original quote/candle timestamps, `providerReceivedAt`, explicit timestamp origins, completeness and price-component provenance. Stale or malformed output remains blocked by the frozen 30,000 ms Data Quality Gate.

## External proof still required

Before any live commissioning, the user must independently confirm regional/division eligibility and an API-enabled practice or live account, then configure token/account ID outside source control. A separate authorization must define environment, one bounded read-only candles/pricing attempt, request budget, readiness/cooldown, redaction, and STOP. No login, onboarding, funding, token request or live call was performed here.

Official references: OANDA REST-v20 Instrument Definitions, Pricing Endpoints/Definitions, Authentication, Troubleshooting & Errors, Best Practices, Development Guide and API Comparison.
