# WILL TRADER — Target Architecture

## Core principle
Build a selective decision system that can be measured and falsified. The system must prefer WAIT over low-quality entries. Engineering quality and statistical validity have priority over trade frequency.

## End-to-end flow

`Market Sources`
→ `Market Data Engine`
→ `Feature Engine`
→ `Multi-Timeframe Context`
→ `Regime Engine`
→ `Setup Engine`
→ `Direction Engine`
→ `Opportunity Quality`
→ `Opportunity Ranker`
→ `Calibration Layer` (only after sufficient evidence)
→ `AI Audit`
→ `No-Trade Engine`
→ `Decision Gate`
→ `Paper/Execution Abstraction`
→ `Outcome Resolver`
→ `Immutable History/Audit Store`
→ `Metrics Engine`
→ `WILL LAB / Learning`

## 1. Market Data Engine
Responsibilities:
- provider abstraction;
- cache keyed by provider/asset/timeframe/request-shape;
- in-flight request dedup;
- global/per-provider rate limiting;
- bounded retries with exponential backoff/jitter for transient errors/429;
- freshness checks based on quote and candle timestamps;
- stale/invalid classification;
- provider latency/error/429 telemetry;
- data quality score;
- optional future failover.

Suggested contract:
```js
getMarketSnapshot({ asset, timeframe, requiredBars, maxAgeMs })
=> {
  snapshot,
  quality: { score, status, reasons },
  provider: { name, latencyMs, cacheHit, stale, rateLimited },
  timestamps
}
```

Hard rule: invalid/stale market data must not become an executable signal.

## 2. Feature Engine
Input: immutable candle/quote snapshot.
Output: deterministic feature vector + feature version.

Suggested groups:
- returns and normalized momentum;
- trend slope / MA distance / MA alignment;
- recent range position / structure;
- realized volatility / ATR-like measures;
- candle body/wick/range anatomy;
- support/resistance distance;
- breakout strength;
- rejection strength;
- pullback depth;
- reversal evidence;
- session/time features;
- spread/payout/provider quality when available.

Every derived feature must have:
- formula;
- unit/range;
- minimum bars required;
- no-look-ahead guarantee;
- tests.

## 3. Multi-Timeframe Context
Do not hard-code one magic combination as truth. Treat combinations as strategy versions.

Initial experimental template:
- context TF: 15m;
- structure/setup TF: 5m;
- trigger/timing TF: 1m.

Output example:
```js
{
  contextDirection,
  contextStrength,
  structureDirection,
  triggerDirection,
  alignmentScore,
  divergenceFlags,
  timeframeQuality
}
```

## 4. Regime Engine
Classify market state separately from direction.
Suggested regimes:
- TREND_UP;
- TREND_DOWN;
- RANGE;
- TRANSITION;
- HIGH_VOLATILITY;
- LOW_VOLATILITY;
- UNKNOWN.

Regime confidence is a classification strength, not win probability.

## 5. Setup Engine
Detect setups from quantitative features, not manual flags.
Suggested setup families:
- CONTINUATION;
- PULLBACK;
- BREAKOUT;
- REJECTION;
- REVERSAL;
- RANGE_FADE;
- STRUCTURE_ONLY;
- UNKNOWN.

Output must contain reason codes and feature evidence.

## 6. Direction Engine
Purpose: estimate directional preference only.
Output:
```js
{
  direction: 'BUY'|'SELL'|'WAIT',
  directionScore,
  components,
  blockers
}
```

Do not mix quality, expected edge or calibrated probability into directionScore.

## 7. Opportunity Quality
Purpose: answer "is this setup worth attention?" independent of direction.
Output:
```js
{
  grade: 'A'|'B'|'C'|'D',
  opportunityScore,
  confluence,
  uncertainty,
  reasons
}
```

## 8. Opportunity Ranker
Ranks eligible candidates across assets.
Rules:
- blocked candidates cannot be #1 executable opportunity;
- ranking uses only validated snapshots;
- compare like-for-like strategy versions;
- log full candidate set so coverage and selection bias can be measured;
- expose why #1 outranks #2.

## 9. Calibration Layer
Disabled until enough reliable prospective data exists.
Purpose: map model/strategy score to empirical probability estimates.
Potential methods later:
- reliability bins;
- isotonic regression;
- Platt/logistic calibration;
- calibration by strategy/setup if sample permits.

Metrics:
- Brier score;
- log loss;
- calibration error/curve;
- sharpness/coverage.

Never call a heuristic score "probability" before this layer is validated out-of-sample.

## 10. AI Audit
OpenAI may:
- identify contradictory context;
- summarize reasons;
- check consistency;
- flag missing evidence;
- produce structured audit metadata.

OpenAI must NOT:
- convert a blocked quantitative signal into executable trade;
- create false certainty;
- invent market data;
- silently change thresholds.

Future Grok role: independent context/news/audit module, not majority voting.

## 11. No-Trade Engine 2.0
Hard veto categories:
- bad/stale/incomplete data;
- provider degraded/rate limited;
- regime/setup incompatible;
- multi-timeframe divergence beyond policy;
- insufficient confluence;
- extreme volatility;
- payout/cost below policy;
- historical segment weakness when statistically defensible;
- uncertainty too high;
- circuit breaker / session risk;
- invalid timing window.

Return stable reason codes, not only prose.

## 12. Decision Gate
Final immutable output:
```js
{
  decisionId,
  strategyVersion,
  asset,
  direction,
  executable,
  theoreticalClickTime,
  expiryTimestamp,
  directionScore,
  opportunityScore,
  grade,
  confidence,
  calibratedProbability: null,
  regime,
  setup,
  dataQuality,
  blockers,
  reasons
}
```

## 13. Paper / Execution Abstraction
Current implementation target: PAPER only.
Future broker adapter must be behind an interface so market intelligence is not coupled to Avalon.

## 14. Outcome Resolver
Requirements:
- resolves only after expiry;
- idempotent;
- immutable entry/expiry timestamps;
- uses provider snapshot at resolution time, not future data available during decision;
- WIN/LOSS/TIE/UNRESOLVED/DATA_INVALID;
- logs price source and data quality.

## 15. Evidence Store
Append-oriented records. Never silently rewrite original decision features after outcome.

Suggested tables/collections:
- `market_snapshots`;
- `decisions`;
- `decision_features` or JSON snapshot;
- `outcomes`;
- `strategy_versions`;
- `provider_events`;
- `experiments`;
- `model_calibrations` (future).

## 16. Metrics Engine
Minimum metrics:
- total decisions;
- BUY/SELL/WAIT counts;
- coverage;
- N resolved;
- wins/losses/ties/unresolved;
- win rate + confidence interval;
- expectancy with explicit payout/cost assumptions;
- segment performance by asset/setup/regime/session/hour/data quality/version;
- provider health/cache hit/429/latency;
- pipeline latency;
- blocker distribution.

## 17. WILL LAB
LAB is experimental and never automatically promotes itself.
Capabilities:
- replay/backtest with temporal integrity;
- forward-paper experiments;
- walk-forward validation;
- shadow strategies;
- champion/challenger comparison;
- drift detection;
- calibration experiments;
- bounded adaptive weights.

Promotion requires predeclared criteria and out-of-sample/prospective evidence.

## 18. Dashboard
Operational panel should show:
- mode: LAB / PAPER / future LIVE;
- provider health;
- freshness and data quality;
- cache hit / rate-limit / 429 status;
- top opportunity and candidate ranking;
- BUY/SELL/WAIT;
- theoretical click time;
- setup/regime;
- direction score;
- opportunity score/grade;
- heuristic confidence clearly labeled;
- calibrated probability only if available;
- blockers/reason codes;
- sample size;
- segmented performance;
- strategy version;
- recent provider/system incidents.

## 19. Observability
Track:
- request count by provider;
- cache hit/miss;
- in-flight dedup hits;
- rate limiter queue/debt;
- 429 count;
- retries/backoff;
- stale snapshot count;
- market snapshot latency;
- feature pipeline latency;
- analyze latency;
- AI latency/cost/errors;
- decision counts by reason;
- outcome resolver lag;
- storage errors.

## 20. Security
- no `.env` in repository;
- no broker credentials in frontend/localStorage/logs;
- no secrets in telemetry;
- no auto-click/real-money execution now;
- origin/CORS restrictions;
- input validation;
- immutable audit trails for future execution;
- kill switch and circuit breakers before live adapter.
