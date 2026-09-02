# WILL TRADER — Metric Definitions

## Status

PAPER/MANUAL only. Metrics describe recorded evidence; they do not prove profitability or enable real execution.

## Evidence-first contract

- `decisionN`: all recorded decisions, including WAIT.
- `resolvedN`: records closed with any recorded outcome.
- `winLossN`: only binary `WIN` and `LOSS` outcomes; this is the denominator for `winRate`.
- `ties`: `TIE` plus legacy `VOID`. Ties are visible but excluded from binary win-rate denominator.
- `invalidOutcomes`: reserved for a closed `DATA_INVALID` outcome when a resolver cannot validate market data.
- `unresolved`: open PAPER decisions without a closed outcome.
- `winRateInterval95`: Wilson descriptive interval over `winLossN`; it is uncertainty reporting, not a calibrated probability.

Every rate in `metrics.evidence` and `metrics.segments` carries its relevant N. When `winLossN < 30`, the API includes an explicit insufficient-evidence warning. Calibration remains a separate future gate.

## Funnel

`observations` → `directionalCandidates` (BUY/SELL direction) → `releasedTrades` (OPEN/CLOSED executable signals) → `executed` (actual manual entry confirmed) → `resolved` → outcome buckets.

`WAIT`, `blockedDirectional`, and `dataRejected` are first-class evidence. `dataRejected` is kept distinct from a strategic WAIT so provider problems are never misread as strategy selectivity.

## Segments

`metrics.segments` reports the same counters by:

- strategy version and model version;
- asset, setup, regime and timeframe;
- UTC decision-clock session and hour;
- data-quality status and source.

UTC session buckets are operational clock labels (`ASIA_UTC`, `EUROPE_UTC`, `US_UTC`, `PACIFIC_UTC`), not a claim that an exchange is open or liquid.

## Operational telemetry

- `dataQuality.freshnessMs`, candle-count and known missing-bar counts describe persisted decision snapshots.
- duplicate and out-of-order event counts remain explicitly unavailable until the provider supplies durable sequence/hash fields.
- `/api/metrics` adds live provider counters: cache, upstream requests, errors, 429s and upstream latency; relay status is reported separately.
- decision, resolver and resolution-lag latency are reported only when recorded; absent fields are not estimated.

## Deliberately absent

- no calibrated probability, Brier score or log loss;
- no expectancy without recorded payout and costs;
- no drawdown without monetary P&L;
- no promotion, threshold tuning, MTF or execution automation.
