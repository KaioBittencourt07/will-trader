# WILL 4.0 — News Source Strategy

## Result from first live commissioning

- BLS official calendar: qualified for macro scheduling.
- Federal Reserve official monthly calendar: qualified for FOMC scheduling.
- GDELT DOC: useful as discovery-only, but rate-limited during commissioning (HTTP 429).

This means market intelligence can have qualified macro coverage while news coverage remains unavailable. The correct state is PARTIAL, not FULL and not SAFE.

## Source roles

### Official / primary sources

Use primary sources for events that may eventually become hard risk windows after endpoint-specific commissioning and policy validation. Candidate public sources include:

- Federal Reserve official releases/calendars;
- BLS official releases/calendars;
- SEC official press-release/RSS feeds;
- CFTC official press-release/RSS feeds;
- U.S. Treasury official releases where relevant.

These sources are independent of broad news aggregators and reduce reliance on a single discovery provider.

### Discovery sources

GDELT remains discovery-only:

- `discoveryOnly: true`;
- `hardBlockEligible: false`;
- headline impact remains UNKNOWN until mapped to a primary source or explicit validated policy;
- HTTP 429 is classified as RATE_LIMITED;
- no automatic retry during bounded commissioning.

## Runtime resilience target

The future news bus should be multi-source and cached:

`primary official feeds -> normalize/deduplicate -> verified news context`

plus

`GDELT/broad discovery -> normalize/deduplicate -> discovery context`

A discovery outage must never silently become NEWS_OK. It remains NEWS_UNKNOWN/PARTIAL coverage.

## Promotion rule

No news source becomes a production hard-block authority only because it is reachable. Each endpoint must pass:

1. provenance verification;
2. timestamp/freshness qualification;
3. relevance mapping to BTC/USD or the active asset;
4. duplicate handling;
5. explicit impact policy;
6. offline tests;
7. bounded external commissioning;
8. manual/guarded activation.
