# WILL Multi-Provider OHLC Resilience

Contract: `multi-provider-ohlc-resilience-v1`

This foundation selects one complete, independently valid REST OHLC snapshot from an ordered provider list. It never merges quote, candles or timestamps across providers. Canonical WILL symbols are mapped explicitly to provider symbols; missing mappings fail closed.

Selection rules:

1. Inspect each provider engine's local readiness without consuming provider data.
2. Skip `COOLDOWN`, `RATE_LIMITED`, `UNAVAILABLE` or `MISCONFIGURED` providers.
3. Request the next provider only in priority order.
4. Accept only a snapshot that already passes the existing `valid/status` gate and independently supplies matching symbol/timeframe, numeric OHLC, valid quote/candle timestamps, `rest-quote-freshness-v1` and timestamp provenance.
5. If every provider fails, return `ALL_PROVIDERS_UNAVAILABLE`; no snapshot or decision is manufactured.

The selected snapshot records canonical `asset`, provider-specific `providerAsset`, selected provider, priority, fallback reason, prior attempts, `provenancePreserved: true` and `mergedAcrossProviders: false`. Compatible concurrent selection requests coalesce; cache/readiness remain isolated inside each provider engine.

WS is not a provider in this contract. It remains SHADOW freshness evidence with `decisionImpact: NONE` and cannot supply authoritative OHLC.

No concrete secondary provider is configured in this phase because the repository contains none and choosing one requires separate credential, plan, licensing and commissioning decisions. Future commissioning requires an explicitly approved adapter, canonical symbol map, credential handling, provider terms, deterministic fixtures, green CI and a separate short live authorization. The frozen 30,000 ms freshness gate must still pass independently.
