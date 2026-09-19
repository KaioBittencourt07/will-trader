# WILL TRADER 4.0 — Market Intelligence Layer

## Objective

Make macro, scheduled economic events, verified news and the operator-facing market chat consume the same structured context. The context layer must improve risk awareness and explanation without becoming an independent BUY/SELL generator.

## Core rule

One truth packet, many consumers:

`verified sources -> adapters -> normalized context -> Market Intelligence Packet -> WILL risk gates / dashboard / market chat / daily brief / learning evidence`

The deterministic WILL Core remains the directional authority. AI and chat may summarize, explain, challenge, approve/veto where explicitly configured, or abstain. They must not invent prices, timestamps, news, events, outcomes or a new trade direction.

## Existing foundation

The repository already has `macroEngine.js`, `newsEngine.js` and `marketContext.js`. They normalize macro/news context and expose `macroBlocked` / `newsBlocked` to the decision pipeline. Without configured adapters, the context correctly remains UNKNOWN.

WILL 4.0 adds a shared `will-market-intelligence-v4` packet and `will-chat-market-packet-v1` so the dashboard/chat do not develop a second, inconsistent market view.

## Source tiers

### Tier A — official / primary sources (preferred for hard risk gates)

- Federal Reserve: FOMC calendar, monetary-policy releases, speeches and official RSS feeds.
- U.S. Bureau of Labor Statistics: public data API, release calendar and official calendar subscription for CPI, Employment Situation/NFP, PPI and related releases.
- European Central Bank: monetary-policy meeting calendar and official RSS/MID feeds.
- U.S. Treasury Fiscal Data: public fiscal datasets for slower-moving macro context.
- Other official statistical/central-bank sources can be added per currency as the asset universe expands.

Only source fields that are documented and empirically qualified should become hard decision gates.

### Tier B — broad news discovery

- GDELT DOC API: broad, near-real-time news discovery and topic search.

Tier B is for discovery, relevance and context. A headline alone does not become a hard trade veto until it is normalized, timestamped, relevant to the asset/currencies and assigned an explicit impact policy. Where possible, material claims should be confirmed by a Tier A/primary source.

### Tier C — optional market/sentiment enrichments

Potential future additions include positioning, volatility, market breadth, on-chain or sentiment sources. These remain descriptive/challenger features until enough prospective evidence demonstrates value. They do not silently change production thresholds.

## BTC/USD first operational scope

BTC/USD context should combine:

- Coinbase temporal authority for current BTC/USD event time and price.
- Twelve Data for closed OHLC/features under the current canonical contract.
- USD macro calendar: FOMC, CPI, Employment Situation/NFP, PCE, GDP and other approved high-impact releases.
- BTC/crypto and global risk news through qualified news adapters.
- Daily context brief shared with the market chat.

## Context states

- `FULL`: macro and news are fresh and sourced.
- `PARTIAL`: only one context family is fresh/sourced.
- `UNKNOWN`: context adapters are absent, stale or unqualified.

UNKNOWN is never labeled SAFE. It is a degraded evidence state. Policy may later choose strict blocking for specific operating modes, but no gate is loosened merely to produce more candidates.

## Hard-block policy

Initial hard blocks remain conservative:

- verified HIGH-impact macro event inside the protection window;
- verified HIGH-impact news inside the configured protection window;
- explicit source integrity/freshness failure where strict context mode is enabled.

Medium/low impact information is context, ranking evidence or explanation only until validated prospectively.

## Daily market chat

The chat must consume `will-chat-market-packet-v1`, not scrape or improvise its own market state. Packet consumers:

- dashboard;
- operator market chat;
- AI audit/validation;
- daily market brief;
- Learning Lab segmentation.

The packet includes instructions to use only supplied structured facts, preserve UNKNOWN, explain hard blocks/degradations and never create a BUY/SELL direction independently.

## Daily brief target

The daily brief should answer, from structured data:

1. What high-impact macro events are scheduled today and when?
2. What changed since the last session/day?
3. What verified news is relevant to BTC and USD?
4. Is the context FULL, PARTIAL or UNKNOWN?
5. What windows should be protected from new entries?
6. What is the current technical/canonical state from WILL?
7. What is learning evidence saying by macro/news regime? (only after enough outcomes)

The same object should be available to the dashboard and chat so there is no duplicated implementation.

## Learning integration

Every admitted study should eventually persist a context fingerprint alongside the canonical study:

- macro status and nearest high-impact event;
- news status and nearest verified high-impact headline/event;
- context coverage/freshness;
- source/version identifiers;
- hard-block/degradation reason codes.

WIN/LOSS statistics can then be segmented by context regime. Promotion of any contextual feature remains LAB/versioned/out-of-sample with manual/guarded promotion.

## AI strategy

AI is an audit/explanation layer, not the signal source. The architecture supports:

- existing OpenAI adapter when configured;
- additional advisor adapters (for example Grok/Claude) only when explicitly configured;
- a future local-model adapter as an optional zero-API-cost assistant;
- deterministic fallback when no LLM is configured.

All providers receive the same bounded structured decision/context payload. No model gets authority to bypass Market Admission, timing, No-Trade or manual execution boundaries.

### OpenAI activation contract

OpenAI activation is part of the WILL 4.0 plan and must happen as a guarded commissioning sequence:

1. Keep the deterministic WILL Core as the sole directional authority.
2. OpenAI may only CONFIRM, VETO or ABSTAIN on a deterministic BUY/SELL/WAIT result.
3. OpenAI must consume only the structured WILL payload and shared market-intelligence/chat packet; it must not fetch or invent its own market facts.
4. Secrets remain local/runtime only. No API key is committed, logged, returned by health endpoints or pasted into project documentation.
5. The first external OpenAI request must be a bounded, explicitly authorized commissioning run.
6. Commissioning must validate schema compliance, timeout/error behavior, disagreement handling, confidence thresholds, fallback behavior and zero-order execution.
7. If OpenAI is unavailable, malformed, slow or disagrees below policy confidence, WILL remains deterministic/fail-closed according to the existing fallback/veto policy.
8. OpenAI output is persisted as advisor evidence, separate from canonical market truth and separate from audited WIN/LOSS outcomes.
9. OpenAI never promotes a strategy, changes thresholds, modifies the frozen freshness contract or enables broker execution.
10. Any future use of OpenAI in Market Chat/Daily Brief must remain explanation-only unless a separately versioned and validated advisor policy explicitly grants a bounded veto role.

### OpenAI runtime milestones

- `AI-0` — offline tests only, no external request.
- `AI-1` — local secret configured and health reports advisor configured without exposing the key.
- `AI-2` — one bounded read-only/simulation commissioning request against a non-executable test payload.
- `AI-3` — advisor enabled on admitted manual-analysis opportunities only; deterministic fallback remains active.
- `AI-4` — advisor evidence stored in history/learning segmentation.
- `AI-5` — same OpenAI adapter receives `will-chat-market-packet-v1` for operator explanations/daily brief, still without independent directional authority.

## Implementation phases

### V4.0-A — shared contract (implemented)

- `context/src/marketIntelligenceV4.js`
- `GET /api/intelligence?asset=BTC/USD`
- shared packet for dashboard/chat/AI/daily brief
- UNKNOWN preserved explicitly

### V4.0-B — free official macro adapters

Commission read-only adapters one endpoint at a time, with bounded tests and source/freshness evidence. Start with BLS calendar + Federal Reserve + ECB as required by the active asset universe.

### V4.0-C — news discovery

Add resilient read-only discovery/primary-source adapters with deduplication, relevance mapping, timestamp/freshness checks and strict non-directional impact semantics. GDELT remains discovery-only and must not be a single point of failure.

### V4.0-D — daily brief + chat

Persist a bounded daily context snapshot and expose it to the operator chat/dashboard. Add source citations/links and a provenance list to each brief.

### V4.0-E — learning

Persist context fingerprints with admitted studies and segment outcomes by context regime. Keep changes evidence-only until minimum prospective sample requirements are met.

### V4.0-F — OpenAI advisor activation

- verify local secret/config without exposing it;
- add a bounded commissioning script/test harness;
- run exactly one explicitly authorized external commissioning call;
- validate schema, confirm/veto semantics, timeouts and deterministic fallback;
- enable OpenAI only after commissioning passes;
- persist advisor evidence separately from market truth/outcomes;
- connect the same advisor to Market Chat/Daily Brief after the decision-review path is stable.

## Safety/engineering invariants

- frozen market freshness contract stays 30,000 ms;
- macro/news context never substitutes for price timestamp authority;
- news headlines never substitute for canonical market data;
- external adapters are opt-in and fail closed/degraded;
- no provider is declared qualified from documentation alone;
- no automatic broker execution;
- no threshold is relaxed just to create a candidate;
- raw secrets are never logged or returned;
- every context/AI decision must be versioned and replayable.
