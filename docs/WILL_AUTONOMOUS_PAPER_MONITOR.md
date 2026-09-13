# WILL TRADER — Autonomous PAPER Monitor

## Purpose

The monitor automates observation and evidence collection for the frozen prospective PAPER batch. It does not trade, click, submit an order, change a threshold, or interpret results.

## Operation

- It starts with the backend and calls the existing opportunities analysis at a bounded cadence of at least 60 seconds.
- Each cadence slot has a deterministic monitorCycleId. Each asset record uses this ID as its durable decision identity.
- The durable monitor state records completed slots. On restart, the same slot is idempotent only when that state and the History Store are available.
- No uncontrolled loop is used; one interval runs at a time and overlapping cycles are skipped.

## Fail-closed behavior

Provider, catalog, data, clock, request, or storage failures produce a skipped invalid cycle or a paused monitor. They never fabricate a quote, outcome, WAIT market observation, or order.

## Operational interface

GET /api/paper-monitor exposes a small operational status object only. The internal onEvent hook is alert-ready but has no WhatsApp, brokerage, or execution integration.

## Safety

PAPER/MANUAL only. Champion, versions, thresholds, ranking/scanner contracts, outcomes, and Phase 20 manifest remain frozen. No auto-click, real-money execution, calibration, tuning, promotion, Meta-Model, or cherry-picking is permitted.

