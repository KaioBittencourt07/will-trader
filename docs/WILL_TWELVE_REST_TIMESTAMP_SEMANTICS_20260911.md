# WILL — Twelve REST Timestamp Semantic Qualification

Date: 2026-09-11
Mode: OFFLINE / DOCUMENTARY ONLY
External provider calls consumed: 0
Frozen freshness contract: 30,000 ms

## Purpose

Determine which Twelve Data REST `/quote` timestamp fields can be treated as authoritative event time for WILL freshness decisions without weakening the frozen 30-second contract.

## Public documentary findings

### `timestamp`

Twelve Data's February 2025 product update states that the `/quote` endpoint `timestamp` field consistently returns the UNIX timestamp of the opening time for the given interval.

WILL classification:

- `PROVIDER_BUCKET_TIME`
- descriptive interval/bucket time only
- not per-tick event time
- cannot evaluate frozen event freshness
- cannot be replaced by client receive time
- cannot commission the provider
- cannot authorize PAPER or live execution

### `last_update_at`

Twelve Data's April 2025 update says `last_update_at` was added to `/quote` responses as a UTC timestamp. A February 2026 update says `/quote` reports the most recent quote time more consistently.

The located public material does not explicitly prove:

- exchange event-time provenance,
- per-event/per-tick semantics,
- clock comparability required by WILL's frozen freshness contract.

WILL classification:

- `RECENT_QUOTE_TIME_SEMANTICS_UNRESOLVED`
- cannot evaluate frozen event freshness

### `last_quote_at`

The current WILL Twelve Data adapter may prefer `last_quote_at` when present, but the public evidence reviewed in this qualification does not prove per-event/exchange event-time semantics or clock comparability.

WILL classification:

- `LAST_QUOTE_AT_SEMANTICS_UNRESOLVED`
- cannot evaluate frozen event freshness

## Safety conclusion

No reviewed Twelve REST timestamp field is presently promoted to `PROVIDER_EVENT_TIME` or `EXCHANGE_EVENT_TIME`.

Therefore:

- freshness contract remains exactly 30,000 ms;
- `arrival/receive time` cannot replace provider event time;
- bucket timestamps cannot bypass freshness;
- provider commissioning remains false;
- PAPER remains unauthorized;
- live execution remains unauthorized;
- orders executed remain zero.

## Next engineering step

Integrate exact timestamp-field provenance into the Twelve REST adapter so server-side `authoritativeFreshness` can distinguish `timestamp`, `last_update_at`, and `last_quote_at` without relying on a generic `last_quote_at_or_timestamp` label. This integration must remain fail-closed and requires no new external provider observation.
