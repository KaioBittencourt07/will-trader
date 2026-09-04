# WILL TRADER — Shared Memory Protocol

## Phase 20C.6.2
- `ws-freshness-rest-ohlc-composition-v1` is an isolated SHADOW-only composer: WS is freshness evidence while REST remains the source of OHLC/history/features and all decision authority.
- `COMPOSABLE` never authorizes a trade; stale REST remains `STALE_MARKET_DATA`. Provenance, timestamps, age, completeness and price divergence are explicit and fail closed.

## Purpose
Keep ChatGPT and Codex aligned through the repository instead of relying on ephemeral chat memory.

## Roles
### ChatGPT
- architecture;
- technical/statistical research;
- hypothesis design;
- review/audit;
- risk/overfitting checks;
- experiment design;
- priority decisions.

### Codex
- repository inspection;
- implementation;
- refactoring;
- tests;
- telemetry;
- reproducible execution;
- delivery reports.

### GitHub repository
Source of truth shared by both.

## Canonical memory files
- `docs/CODEX_HANDOFF.md` — current execution handoff and frozen decisions.
- `docs/WILL_ARCHITECTURE.md` — target architecture and contracts.
- `docs/WILL_ROADMAP.md` — phases and Definition of Done.
- `docs/WILL_SHARED_MEMORY.md` — collaboration protocol.
- `docs/DELTA_REPORT_YYYYMMDD.md` — delta between workspace and repository.
- `docs/WILL_DECISIONS.md` — future architecture decision log.
- `docs/WILL_EXPERIMENTS.md` — future experiment registry/index.
- `docs/WILL_METRICS.md` — future metric definitions.

## Work cycle
1. ChatGPT defines or audits hypothesis/architecture.
2. Decision is written/versioned in repository if it changes project truth.
3. Codex reads canonical docs before coding.
4. Codex implements on dedicated branch.
5. Codex runs tests and records exact result.
6. Codex documents files changed, telemetry and open risks.
7. GitHub commit/PR becomes the transfer object back to ChatGPT.
8. ChatGPT reviews diff/results and decides next hypothesis or promotion.

## Required Codex preflight for every substantial round
Before coding:
1. read `docs/CODEX_HANDOFF.md`;
2. read `docs/WILL_ARCHITECTURE.md`;
3. read `docs/WILL_ROADMAP.md`;
4. identify current branch/head;
5. compare against latest local/workspace version when applicable;
6. run baseline tests;
7. verify no secrets are about to be committed.

## Required Codex completion report
Every substantial delivery must provide:
- branch and commit SHA;
- files changed;
- tests/checks executed and outcomes;
- endpoints/contracts changed;
- telemetry observed;
- migrations required;
- assumptions made;
- blockers/open risks;
- explicit list of items intentionally not implemented;
- recommended next step.

## Decision discipline
A project-level decision is not considered durable until captured in repository documentation or code/config with version history.

Examples that MUST be durable:
- thresholds;
- strategy version;
- feature formula;
- timeframe combination;
- outcome definition;
- promotion criteria;
- risk veto;
- probability calibration policy;
- provider fallback policy.

## Experiment discipline
Every strategy experiment should contain:
```text
experimentId
hypothesis
championVersion
challengerVersion
parameterSet
start/end or target sample
primaryMetric
secondaryMetrics
segments
promotionCriteria
stopCriteria
result
status
```

Allowed statuses:
- PROPOSED
- RUNNING_SHADOW
- RUNNING_PAPER
- REJECTED
- CHALLENGER
- PROMOTED
- RETIRED

## Frozen safety principle
Neither ChatGPT nor Codex should silently transform WILL from PAPER/MANUAL into real-money automated execution. That requires a separate future architecture/security decision and explicit user direction.

## Statistical principle
Do not optimize from anecdotes. Changes are evaluated against versioned batches and temporal/out-of-sample evidence. Heuristic confidence is not win probability.

## Synchronization phrase for future rounds
When Codex starts a new substantial task, treat the following as the default instruction:

> Read the canonical WILL docs in `docs/`, inspect the current branch/workspace delta, preserve frozen decisions, run baseline tests, implement only the next approved phase, and return a reproducible completion report with commit SHA, tests, telemetry and remaining risks.

## Fase 19 — reliability hardening
- `entry-timing-v2`: `TOO_EARLY` is used when `current < validFrom`; `LATE_ENTRY` is reserved for an expired window.
- Error attribution is evidence-only. A standalone `LOSS` remains `UNKNOWN`; a specific cause requires explicit persisted evidence.
- The PAPER runner may hydrate `completedCycleIds` from durable storage. Without durable storage, restart safety is not guaranteed.
- PAPER/MANUAL remains mandatory. No Avalon auto-click, threshold change, calibration or promotion is authorized.

## Fase 20 — prospective PAPER evidence foundation
- The Champion is frozen in `docs/WILL_PROSPECTIVE_PAPER_MANIFEST.json`; no version, threshold, ranking or scanner contract can silently enter the batch.
- New decisions are recorded prospectively and auditably, including BUY, SELL, WAIT and rejected candidates. Outcomes remain pending until a temporally valid post-expiry resolution.
- DATA_INVALID is never rewritten as WIN or LOSS. Payout and costs begin as NOT_AVAILABLE; no EV, edge or assertiveness claim is permitted.
- PAPER/MANUAL remains mandatory. The batch forbids Avalon auto-click, real orders, auto-tuning, auto-promotion, Meta-Model training and premature probability calibration.

## Fase 20B — autonomous PAPER monitor
- A bounded monitor collects prospective PAPER observations through the existing analysis path, with a minimum 60-second cadence and no uncontrolled loop.
- Each cadence slot has a stable monitorCycleId and durable state. Without durable state, the monitor pauses; restart idempotency still depends on stable decision IDs plus History Store durability.
- Provider, data, clock, catalog and storage failures are fail-closed as paused or skipped invalid cycles; no synthetic data, outcome or execution is created.
- The monitor has no order or click capability. Its event hook is alert-ready only; no WhatsApp or broker integration is implemented.

## Fase 20B.1 — Analyze History Contract
- POST /api/analyze persists every valid decision response, including Data Guard WAIT, through the existing durable History Store before returning history metadata.
- context.decisionId is preserved for retry-safe deduplication; identical requests return the same history record instead of appending another decision.
- The response contract includes history id, status and idempotent flag. No market data, outcome, execution or strategy behavior is invented by this persistence step.

## Fase 20C.1 — Market Access & Avalon Universe Gate
- Avalon availability is evidence-only. `AVALON_ALLOWLIST_FILE` is a read-only local manual export with per-asset broker symbol, source, verification timestamp and status; price-provider knowledge is never treated as broker tradability.
- Missing, malformed, unverified or expired catalog evidence remains `AVALON_CATALOG_UNVERIFIED` and fail-closed. No collection may start from that state.
- `GET /api/market/diagnostic` is a diagnostic-only Twelve Data gate that distinguishes credential, rate-limit, blocked network, invalid response and stale-data failures while sharing the existing cache/rate limiter.
- The gate does not bypass environment `EACCES`, start a batch, alter the Champion or enable Avalon clicks/orders. PAPER/MANUAL remains mandatory.

## Fase 20C.2 — PAPER Research / Avalon Execution Decoupling
- PAPER research uses the canonical market universe and verified Twelve Data evidence only. An Avalon catalog is neither a research universe nor proof of a provider symbol.
- Missing Avalon evidence no longer blocks PAPER research, but remains `AVALON_CATALOG_UNVERIFIED` for all Avalon availability or execution claims.
- The prospective monitor remains fail-closed until the Twelve Data diagnostic returns `HEALTHY`; stale, invalid, rate-limited, credential and network failures do not begin a cycle.
- No Champion, threshold, scanner, ranking, feature, regime, timing or BUY/SELL/WAIT contract changed. PAPER/MANUAL only; no order, click or money flow is authorized.

## Fase 20C.3 — PAPER Monitor Failure Observability
- A thrown PAPER monitor cycle remains fail-closed as `SKIPPED_INVALID_CYCLE` with `CYCLE_FAILURE`; its cadence id remains durably recorded to prevent retry churn.
- Failure events now expose only a bounded, deterministic `errorCode` and sanitized `errorDetail`. Credentials, authorization headers, tokens, credential-bearing URL parts and stack traces are excluded from events and backend logs.
- Storage persistence failures remain `PAUSED/STORAGE_FAILURE`. The observability path creates no WAIT, quote, outcome or execution capability.

## Fase 20C.4 — PAPER Monitor Timeout Hardening
- `WILL_PAPER_MONITOR_REQUEST_TIMEOUT_MS` controls the bounded timeout used by both internal PAPER monitor requests. Its default is 55 seconds for the minimum 60-second cadence.
- The timeout must be finite, positive and strictly below cadence minus the 1-second safety margin. Invalid configuration is `MONITOR_TIMEOUT_CONFIG_INVALID` and fails closed before any internal request.
- Timeout aborts remain invalid observations with durable idempotency and no synthetic decision; their sanitized monitor diagnostic uses `REQUEST_TIMEOUT`.


## Fase 20C.5 — Opportunity Pipeline Latency Hardening
- The PAPER monitor diagnostic and opportunity scan now use the same 50-candle market request shape, allowing the scan to reuse the diagnostic cache entry instead of waiting for a second 60-second provider slot.
- Opportunity responses expose additive per-stage latency telemetry; Market Data Engine metrics separately expose rate-limiter wait count and duration.
- Freshness remains fail-closed and unchanged. Snapshot age is derived from the provider quote timestamp; candle timestamp remains separate evidence.
- No Champion, strategy, threshold, score, ranking, BUY/SELL/WAIT, Outcome Resolver or Evidence Store contract changed. PAPER/MANUAL remains mandatory.

## Fase 20C.7 — Provider Efficiency & Credit Accounting
- `provider-efficiency-v1` atribui a cada request/ciclo requests HTTP externos, cache hits/misses, deduplicação, espera do limiter, latência externa e créditos estimados.
- Crédito é explicitamente estimado e não autoritativo. O modelo local assume um crédito por endpoint/símbolo; somente `/api_usage` do provider representa a conta real.
- O ciclo PAPER diagnostic -> opportunities usa a mesma chave de 50 candles: em um ciclo saudável de um ativo partindo de cache vazio, o diagnóstico faz 2 requests HTTP (~2 créditos estimados) e opportunities reutiliza o snapshot com 1 cache hit, 0 requests externos e 0 segunda espera do limiter.
- Scanner e pipeline decisório não consultam Twelve Data diretamente; recebem os snapshots já contabilizados. Telemetria é somente saída e nunca cria ou altera preço, timestamp, decisão, WAIT, outcome ou execução.
- 429, stale, missing e provider errors continuam fail-closed. Champion, versões, thresholds, freshness, timing, scanner, ranking, timeouts e contratos decisórios permanecem congelados; PAPER/MANUAL continua obrigatório.

## Fase 20C.8 — Twelve WebSocket Market Feed Foundation
- Uma única conexão Twelve Data WebSocket por processo pode observar uma lista controlada de símbolos, com subscribe consolidado, heartbeat, reconexão com backoff limitado e shutdown explícito.
- O feed é desativado por padrão e exclusivamente `SHADOW_OBSERVABILITY`. Ticks não substituem candles REST, não constroem OHLC, não evitam requests e não entram em BUY/SELL/WAIT.
- A telemetria aditiva mede mensagens, símbolos ativos, reconexões, idade do último tick, gaps, duplicatas, disponibilidade e potencial observacional de redução REST; nenhum segredo é exposto.
- Champion, estratégia, thresholds, timing, freshness decisório, scanner, ranking e contratos decisórios permanecem congelados. PAPER/MANUAL continua obrigatório; nenhum batch oficial ou merge foi autorizado.

## Fase 20C.9 — Twelve WebSocket Live Commissioning / Provider Validation
- O commissioning é manual, limitado a uma conexão, um símbolo e no máximo 60 segundos; não faz REST, polling de quota, monitor PAPER ou batch.
- APPROVED exige evidência real de conexão, aceite de subscrição e tick. Ausência de credencial ou bloqueio do plano/provider permanece BLOCKED, sem fallback inventado.
- Telemetria sanitizada inclui conexões, subscrições solicitadas/aceitas/rejeitadas, primeiro/último tick, freshness, gaps, duplicatas, reconnect/backoff, disconnect e uptime.
- Ticks continuam exclusivamente SHADOW: zero candles OHLC, zero requests REST evitados e zero impacto em Champion, estratégia, thresholds ou BUY/SELL/WAIT.

## Fase 20C.6.1 — Freshness / Provider Timing Investigation
- O gate permanece `rest-quote-freshness-v1`: idade é relógio local menos timestamp original da quote REST; threshold de 30s não mudou.
- Quote, candle, receive, cache, latência HTTP e tick WS agora têm telemetria separada. Candle fechado e latência exclusiva do provider ficam explicitamente não verificáveis quando o payload não prova a semântica.
- Cache hits reavaliam freshness pelo quote timestamp atual; `storedAt` nunca rejuvenesce market data. O caso determinístico de 30,5s permanece `STALE_MARKET_DATA`.
- O limiter de 60s preserva a fase do primeiro miss/process start; não arredonda para `:30`. Diagnostic -> opportunities reutiliza a mesma chave de 50 candles sem segunda espera.
- Resultado para 20C.6: `BLOCKED/EXTERNAL PROVIDER SEMANTICS`. WS continua SHADOW e nenhum batch, Champion, threshold ou decisão foi alterado.
