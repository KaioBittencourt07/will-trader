# Feature & Setup Engine 2.0

`candle-price-action-v2` transforms provider OHLC candles into a deterministic, versioned snapshot. It is evidence for a decision, never a claim of probability or a permission to execute a trade.

The snapshot includes candle body/wicks/close location, ATR and normalized range, moving-average distance and slope, momentum, support/resistance distance, compression/expansion, breakout/rejection, pullback/recovery, reversal, exhaustion and four swing-structure flags. The swing flags use `swingStructure` so they never overwrite the legacy numeric `structure` factor. It returns `INSUFFICIENT_BARS` rather than inventing values for fewer than fourteen complete OHLC candles or a zero-range latest candle.

`classifySetup` preserves the existing frozen thresholds and returns a separate descriptor:

- `setupType`: the deterministic setup label;
- `setupDirection`: `BUY`, `SELL`, or `NEUTRAL`;
- `setupQuality`: descriptive `A` through `D`, derived from the existing setup confidence, not a calibrated probability;
- `evidence` and `invalidation`: machine-readable audit arrays;
- `featureVersion`: the source feature contract.

History stores this descriptor and immutable feature snapshot with every signal. Metrics segment evidence by feature version, setup type, setup quality and setup direction. Replay keeps old records compatible and compares fields only when that record actually persisted the field.

This phase remains PAPER/MANUAL. No click automation, broker integration, threshold reduction, MTF, probability calibration, or online learning is included.
