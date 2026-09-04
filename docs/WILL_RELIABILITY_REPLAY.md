# Data Reliability and Replay Foundation

## Provider retries

The Market Data Engine retries only transient provider failures (429, 5xx and network/timeout-like failures). `Retry-After` is honored when exposed by the provider; otherwise bounded exponential backoff with jitter applies. Retry budget is bounded by attempts and a time window. No retry path manufactures a snapshot.

`/api/market/status` and `GET /api/metrics` expose cache, retry, 429, error, latency, provider state and degradation fields. Provider state is descriptive: `HEALTHY`, `DEGRADED` or `RATE_LIMITED` in the current adapter. A successful upstream response resets it to `HEALTHY`.

## Outcome validity

After expiry, a missing, invalid or stale reference price resolves as `DATA_INVALID`, never WIN/LOSS/TIE. The append-only history retains the resolution reason and settlement remains idempotent.

## Offline replay

`learning/src/replayFoundation.js` reconstructs a deterministic `willCore` input from stored evidence. It has no provider or AI dependency and never rewrites history. `replayEvidenceBatch(records)` reports mismatch reason codes grouped by strategy/model version.

Example: `node --test tests/replayFoundation.test.js`
