# WILL shared memory

## Fase 19 — reliability hardening

- `entry-timing-v2` uses `TOO_EARLY` for `current < validFrom`; `LATE_ENTRY` is reserved for an expired window.
- Error attribution is evidence-only. A standalone LOSS stays `UNKNOWN`; `FALSE_BREAKOUT`, `DIRECTION_ERROR`, `REGIME_TRANSITION` and `PROVIDER_DIVERGENCE` require explicit persisted evidence.
- The PAPER runner deduplicates cycle IDs in memory and can hydrate `completedCycleIds` supplied by a durable store. It does **not** claim restart safety without that persisted source.
- PAPER/MANUAL remains mandatory; no Avalon execution, auto-click, threshold change, calibration or promotion is authorized.
