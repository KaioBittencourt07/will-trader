# WILL TRADER — Prospective PAPER Evidence Protocol

## Scope

The batch identified in `WILL_PROSPECTIVE_PAPER_MANIFEST.json` measures the frozen Champion. It is not an optimization, calibration, promotion, or claim of profitability.

## Frozen Champion

The manifest records the strategy, deterministic model, feature, regime and timing versions; minimum score and confidence; scanner/ranking contracts; outcome definition; and fail-closed data-quality contract. A version mismatch is rejected by the prospective recorder rather than being silently mixed into the batch.

## Collection

Every new decision is recorded prospectively, including BUY, SELL, WAIT and technically available but non-selected candidates. Evidence contains the decision/window, data/provider condition, shadow dimensions, version metadata, and later manual execution quality when available.

## Outcome and execution

Only the existing prospective resolver can close a directional PAPER record, on or after expiry and with a reference timestamp on or after expiry. Invalid, stale or ambiguous reference data closes as DATA_INVALID, never WIN or LOSS. Manual click and entry fields remain separate from the recommendation.

## Interpretation limits

Coverage, WAIT rate, outcome buckets and Wilson intervals are descriptive. Scores, confidence, readiness, familiarity and robustness are not calibrated probabilities. Payout/cost begins as NOT_AVAILABLE, so this batch produces no real EV or expectancy.

## Frozen safeguards

PAPER/MANUAL only. No real orders, Avalon auto-click, threshold/ranking changes, auto-tuning, auto-promotion, Meta-Model training, probability calibration, or retrospective cherry-picking during the batch. Provider, storage, clock, or data-quality failure remains fail-closed.

