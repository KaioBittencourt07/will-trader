# WILL TRADER — Shared Memory Protocol

## Phase 20C.6.2
- `ws-freshness-rest-ohlc-composition-v1` is an isolated SHADOW-only composer: WS is freshness evidence while REST remains the source of OHLC/history/features and all decision authority.
- `COMPOSABLE` never authorizes a trade; stale REST remains `STALE_MARKET_DATA`. Provenance, timestamps, age, completeness and price divergence are explicit and fail closed.

## Phase 20C.6.4
- `provider-readiness-v1` centralizes fail-closed REST readiness. A 429 opens cooldown from safe provider headers or a 60-second local default and is never retried immediately.
- Status inspection consumes zero provider requests; cooldown blocks new misses while cache timestamps retain their original provenance and freshness semantics.
- WS remains SHADOW with `decisionImpact: NONE`; no live commissioning, 20C.6 or prospective batch is authorized by this phase.

## Phase 20C.6.6
- `multi-provider-ohlc-resilience-v1` selects one complete, independently valid provider snapshot in priority order; it never merges or rejuvenates provider data.
- Canonical WILL symbols and provider symbols are explicitly mapped. Provider readiness/cache remain isolated and all providers bad fails closed as `ALL_PROVIDERS_UNAVAILABLE`.
- No secondary commercial provider or live commissioning is configured by this foundation; both require separate external and audit decisions.

## Phase 20C.6.7
- OANDA REST-v20 is `QUALIFIED_OFFLINE` under `secondary-provider-qualification-v1`; live eligibility remains `EXTERNAL_UNVERIFIED` and the adapter is OFF by default.
- `EUR/USD -> EUR_USD`, `1min -> M1`, midpoint candles, pricing quote timestamp and `complete=true` OHLC are independently validated without network or credentials.
- Stale/malformed OANDA evidence remains blocked by the frozen 30-second gate; no live provider, commissioning, batch or authority change is enabled.

## Phase 20C.6.8 Part A
- `oanda-rest-v20-readonly-adapter-v1` and the one-shot `commission:oanda-readonly` command are implemented OFF by default with a strict two-GET budget and zero retries.
- Configuration is secret-environment only; sanitized output never includes token/account values. All failures remain fail-closed through provider readiness/cooldown.
- Status is `LIVE_READY_FOR_LOCAL_COMMISSIONING`; no live OANDA call was made by Codex and Part B still requires the explicit local external gate.

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

## Fase 20C.6.9 — Tiingo FX Offline Qualification
- A simbologia oficial prova `EUR/USD -> EURUSD`; o transformer offline usa somente esse mapping explícito e nunca infere aliases.
- A documentação oficial prova os campos REST top-of-book e OHLC e a proveniência temporal do WebSocket, mas não prova explicitamente `resampleFreq=1min` nem fornece evidência de candle fechado/completo.
- O resultado é `QUALIFIED_OFFLINE_WITH_LIMITATIONS`: candles Tiingo permanecem `UNVERIFIED_BY_PROVIDER_PAYLOAD`, sem `latestClosedCandleTimestamp`, e falham fechados no `multi-provider-ohlc-resilience-v1`.
- Freshness continua derivada exclusivamente de `quoteTimestamp` sob o gate congelado de 30.000 ms; receive time, candle time e WebSocket nunca rejuvenescem o dado.
- Nenhuma chamada, conta, token, commissioning, batch, 20C.6, mudança de Champion/estratégia/threshold ou merge foi autorizado ou executado.

## Fase 20C.6.10 — Massive Currencies Offline Qualification
- Mappings oficiais são específicos por endpoint: aggregates/snapshot `C:EURUSD`, quotes históricas `C:EUR-USD`, last quote por `EUR/USD`, e WebSocket subscription `EUR-USD`; não há conversão silenciosa entre eles.
- REST e WebSocket documentam aggregates de um minuto derivados de bid/ask/BBO, com lacunas quando não há novas quotes; nenhuma lacuna é preenchida sinteticamente.
- `t` é início da janela REST e `s/e` são início/fim da janela WS. A documentação não garante aggregate finalizado/imutável, então `e` ou relógio após o fim nunca produz `VERIFIED_CLOSED`.
- Resultado `QUALIFIED_OFFLINE_WITH_LIMITATIONS`: transformer puro, default OFF, candles `UNVERIFIED_BY_PROVIDER_PAYLOAD`, e rejeição pelo contrato congelado `multi-provider-ohlc-resilience-v1`.
- Freshness permanece exatamente 30.000 ms sobre o timestamp original da last quote; nenhum receive/bar/WS timestamp rejuvenesce dados.
- Basic Free documenta 5 calls/min, histórico limitado/EOD/minute aggregates, mas não quote/snapshot/WS real-time; uso futuro comercial exige plano/contrato e revisão próprios.
- Zero provider consumption, conta, key, commissioning, batch, 20C.6, mudança decisória ou merge.

## Fase 20C.6.11 — Saxo OpenAPI Charts Offline Qualification
- Mapping oficial congelado: `EUR/USD -> EURUSD`, UIC `21`, `FxSpot`; WILL `1min -> Horizon=1`.
- Snapshot inicial de subscription é documentado como samples recentemente concluídos. Em update que contém no mesmo evento o bar agora fechado e o novo bar, somente o mais antigo é fechado; o novo permanece current. REST GET, posição, relógio e intervalo temporal não provam closure.
- `DataVersion`, `ChartInfo.FirstSampleTime`, `DelayedByMinutes` e `Data[].Time` permanecem proveniência separada e não rejuvenescem dados.
- Charts não fornece quote timestamp independente adequado e a própria Saxo recomenda `/InfoPrices` ou `/Prices` para preço atual; portanto o resultado é `QUALIFIED_OFFLINE_WITH_LIMITATIONS` e `QUOTE_FRESHNESS_UNVERIFIED` falha fechado no multi-provider.
- Gate continua exatamente 30.000 ms. Adapter é puro/default OFF; zero conta, token, live/sim call, commissioning, batch, 20C.6, mudança decisória ou merge.

## Fase 20C.6.12 — Cross-Provider Composition Qualification
- Resultado `COMPOSABLE_OFFLINE` para fixtures controladas: Twelve WS é autoridade exclusiva de quote/freshness; Saxo Charts é autoridade exclusiva de OHLC M1 fechado.
- `quoteTimestamp` vem somente do timestamp nativo do evento Twelve; `latestClosedCandleTimestamp` e todos os candles vêm somente da Saxo sob regra documental já qualificada.
- Receive/cache/wall-clock/candle timestamps nunca rejuvenescem quote. Quote provider nunca declara candle fechado e não há merge de OHLC.
- Gate permanece exatamente 30.000 ms. Stale/missing/invalid quote, completeness Saxo ambígua, mismatch ou proveniência insuficiente falham fechados.
- Mesmo no happy path, saída é `OFFLINE_QUALIFIED`, `valid:false`, `decisionImpact:NONE` e sem autorização de PAPER prospectivo; o multi-provider congelado não é contornado.
- Zero chamada, login, conta, token, app, commissioning, batch, 20C.6, alteração decisória ou merge.

## Fase 20C.6.13A — Cross-Provider Live Commissioning Readiness
- Resultado `LIVE_COMPOSITION_READINESS_PREPARED`, apenas PREP: harness puro e comando local sem cliente de rede, default OFF e bloqueado sem autorização exata de 13B.
- Budget futuro congelado: uma sessão, EUR/USD/1min, uma subscription por provider, zero retries, no máximo um reconnect observável; reset invalida continuidade.
- Saxo permanece `OHLC_CLOSED_ONLY` nos contextos allowlisted; Twelve WS permanece `QUOTE_FRESHNESS_ONLY` pelo timestamp nativo do evento. Não há substituição temporal ou OHLC mixing.
- Relatório sanitizado inclui config/entitlement, conexão, freshness/completeness, reason codes e contadores, mas nunca valores de segredo. Entitlements permanecem `UNVERIFIED` até evidência externa.
- Happy path continua `valid:false`, `decisionImpact:NONE`, `prospectivePaperAuthorized:false`; gate permanece 30.000 ms.
- Fase 13B, 20C.6, PAPER prospectivo, chamadas externas, conta/app/token e merge permanecem não autorizados.

## Fase 20C.6.13B — Controlled Read-Only Cross-Provider Commissioning
- Resultado `BLOCKED_EXTERNAL`: Saxo e Twelve credentials estavam ausentes no runtime Codex; o harness parou antes de acesso externo, com zero sessões/conexões/subscriptions.
- Harness isolado/default OFF exige autorização 13B exata e Saxo SIM; budget: uma sessão EUR/USD/1min, uma subscription por provider, zero retry, no máximo um reconnect.
- Gate permanece 30.000 ms; Saxo somente OHLC fechado por contexto documental e Twelve somente quote freshness por event timestamp nativo.
- `decisionImpact:NONE`, `prospectivePaperAuthorized:false`, zero ordens; 20C.6 final, PAPER prospectivo e merge continuam não autorizados.

## Fase 20C.6.13B-R1 — Offline Root-Cause + Hardening
- Saxo: ausência de `FieldGroups:["ChartInfo"]` no request produziu Snapshot sem a evidência Horizon; parser não foi relaxado. Wrapper `Snapshot`, ChartInfo.Horizon=1 e completed initial samples são obrigatórios.
- Twelve: preflight de WebSocket bloqueia runtime incompatível antes de rede; hard cap real de um reconnect e uma subscription foi aplicado, excesso não agenda timer, e stop cancela qualquer retry pendente. Sem REST fallback ou quote sintética.
- Gate 30.000 ms, PAPER/MANUAL, fail-closed, Champion e contratos decisórios permanecem congelados. Nova sessão depende de autorização separada após auditoria.

## Fase 20C.6.13B-R3 — Offline Root-Cause após R2
- Saxo R2 provou Snapshot/ChartInfo/Horizon 1, mas R1 havia pedido somente o grupo ChartInfo. Request corrigido para grupos `ChartInfo` + `Data`; Data ausente, vazio e OHLC malformado têm blockers distintos e não são inferidos.
- Twelve R2 respeitou reconnect=1, porém o ErrorEvent genérico não permite atribuir retroativamente DNS/TLS/proxy/firewall/auth. Diagnóstico agora retém somente fase/categoria/code/close code sanitizados quando o runtime os fornece.
- Zero chamadas/credenciais em R3. Gate, budgets, PAPER/MANUAL, fail-closed, Champion, thresholds e ausência de ordens/merge permanecem congelados.

## Fase 20C.6.13B-R5 — Offline Root-Cause após R4
- Saxo FxSpot Default é documentalmente BidAsk; o parser single-OHLC corretamente bloqueou. Diagnóstico estrutural allowlisted reconhece o shape sem valores/payload bruto, mas nunca sintetiza midpoint ou escolhe bid/ask.
- Twelve ErrorEvent PRE_OPEN permaneceu genérico. Runtime local, nested code/cause e close code/reason são agora capturados e redigidos quando disponíveis; nenhum DNS/TLS/provider preflight foi chamado.
- R6 externa não é recomendada antes de decisão formal separada sobre semântica BidAsk. Gate 30s, budgets 1/1, PAPER/MANUAL, fail-closed, Champion/thresholds/dashboard e zero ordens/merge permanecem congelados.

## Fase 20C.6.13B-R5S — Decisão Semântica Bid/Ask
- `bid-ask-ohlc-v1` preserva OHLC bid e ask separadamente; midpoint e side selection são nulos/proibidos.
- Saxo documental BidAsk pode ter `providerEvidenceValid:true` e `marketDataRepresentation:BID_ASK_OHLC`, mas permanece `championCompatible:false`.
- Validação é independente por lado; nenhum cross-side hard gate foi criado sem garantia documental. Single-OHLC e Champion permanecem inalterados.
- Com Twelve fresh, composição é somente provider evidence offline e não gera direção, score, decisão ou PAPER. Zero calls/credentials; R6 continua não autorizada.

## Fase 20C.6.13B-R6-PREFLIGHT — Auditoria Offline do Gate
- Readiness do runner exige o contrato explícito `DIRECT_OHLC_PLUS_INDEPENDENT_QUOTE`; somente `COMPOSABLE_OFFLINE` não basta.
- BidAsk válido + Twelve fresh é provado por regressão como `BLOCKED_EXTERNAL`, com todos os marcadores não decisórios expostos no relatório sanitizado e sem conversão, midpoint, lado escolhido ou Champion bypass.
- Twelve permanece limitado a exatamente uma conexão/subscription request/accept, reconnect <= 1, gate 30s e zero REST fallback.
- Recomendação de R6 depende desta prova e de auditoria independente; este preflight não executa nem autoriza R6.

## Fase 20C.6.13B-R7-PREP — Twelve Transport Root-Cause
- Node 24.20.0/Undici 7.29.0 expõe WebSocket EventTarget; o ErrorEvent genérico pré-open não trouxe code/cause público e close 1006 não atribui a camada da falha. Não há canal oficial estável de diagnostics_channel específico para causa do upgrade WebSocket.
- Endpoint/path/query e payload subscribe atuais conferem com a documentação Twelve. Nenhuma chave ou conexão WebSocket foi usada nesta fase.
- TRANSPORT_PREFLIGHT não autenticado: DNS + TCP 443 nu + TLS 443 com SNI/certificado, separadamente em IPv4/IPv6; sem HTTP, upgrade, subscribe ou payload. Resultado: ambos os families com TCP/TLS autorizado em TLS 1.3, sem proxy em variáveis de ambiente.
- Conclusão B: transporte básico local saudável; erro R6 continua provável em upgrade/auth/entitlement/provider e só pode ser discriminado por futura sessão explicitamente autorizada. R7 não foi executada nem autorizada.

## Fase 20C.6.13B-R8-PREP — Twelve Handshake Offline
- Harness local confirmou request target/query placeholder, Upgrade RFC 6455, version 13, key válida, permessage-deflate e subscribe somente após OPEN. Node envia User-Agent `node`, sem Origin/Authorization neste caminho.
- Redirect 302 e rejeição 403 locais colapsam na API pública para ErrorEvent vazio + close 1006; não se pode inferir status, auth ou entitlement de 1006. Classificações específicas só são usadas quando a evidência é observável; caso contrário fica `PRE_OPEN_ABNORMAL_CLOSE` com causa não confirmada.
- Canais oficiais Undici foram auditados: close é redundante e socket_error não atribui a instância; rejeição HTTP não expôs status pelo canal. Nenhum hook privado, troca para `ws`, ProxyAgent ou dispatcher foi introduzido.
- Conclusão B: implementação local e protocolo Twelve são compatíveis; blocker provável permanece auth/entitlement/upgrade/provider. Zero provider WebSocket, credenciais, R8, REST fallback, PAPER ou merge.

## Fase 20C.6.13B-R8A-PREP — Diagnosticador de Upgrade Offline
- `twelve-handshake-diagnostic-v1` é isolado do feed/commissioning/Champion: uma tentativa, nenhum redirect/retry/frame/subscribe e fechamento após a resposta HTTP Upgrade.
- Saída allowlisted observa 101/302/401/403/429/timeout sem API key, Sec-WebSocket-Key, Location, headers, IP, body ou payload bruto. 101 também exige prova criptográfica de `Sec-WebSocket-Accept`.
- Apenas servidores localhost sintéticos foram usados. Alvo externo exige autorização futura exata e permaneceu bloqueado; zero provider calls e zero credenciais reais nesta fase.
- R8A externa, PAPER e merge permanecem não autorizados.

## Fase 20C.6.13B-R8B-PREP — Fluxo Pós-101 Offline
- `twelve-post-101-diagnostic-v1` observa OPEN, um subscribe EUR/USD, primeiro status, primeira quote e close/timeout, isolado de feed/commissioning/Champion/PAPER.
- Harness RFC6455 localhost cobre accepted+quote, rejected, auth/entitlement explícito, unknown, timeout, close antes do status e accepted sem quote. Ordem é obrigatória; quote precoce falha fechado.
- Saída é allowlisted e não contém query/key/header/frame/payload/preço/IP/token. Zero reconnect/retry/redirect/REST/Saxo.
- Conclusão A: protocolo pós-101 validado offline; futura R8B diagnostic-only exige auditoria e autorização separadas. Nenhuma execução externa, credencial real, PAPER ou merge ocorreu.

## Fase 20C.6.13B-R8C-PREP — Observação Prolongada Offline
- `twelve-post-subscribe-observation-v1` prolonga somente a observação diagnóstica após subscribe aceito, com janela configurável e limite rígido de 60s.
- Harness localhost prova quote imediata/tardia, silêncio, close, controle/heartbeat e múltiplas mensagens não-price antes da quote, sem inferir auth, entitlement, plano, mercado ou causa de provider.
- Uma conexão, um subscribe EUR/USD, zero retry/reconnect/redirect/REST/Saxo e saída exclusivamente sanitizada. R8C externa, commissioning, Champion, PAPER, dashboard e merge não estão autorizados.
- Audit fix: pre-accept possui timeout próprio; somente o aceite explícito de EUR/USD inicia a janela pós-subscribe. O tempo até a primeira quote é medido desde esse aceite.

## Fase 20C.6.13B-R8D-PREP — Heartbeat-Aware Offline
- R8C foi consumida sem quote em 60s e sem causa confirmada. `twelve-heartbeat-observation-v1` testa apenas a variável protocolar heartbeat após aceite explícito, sem atribuir causalidade.
- Default heartbeat 10s; futuro uso externo não aceita frequência maior que uma vez por 10s. Janela pós-aceite <=60s, timeout pré-aceite separado, uma conexão/subscribe e timers cancelados no STOP.
- Harness sintético cobre quote antes/depois de heartbeats, silêncio, close, mensagens recebidas e ausência de status. R8D externa permanece não autorizada; zero provider/credencial/REST/Saxo/commissioning/Champion/PAPER/dashboard/ordem/merge.

## Fase 20C.6.13B-R8E-PREP — Twelve WS Readiness Gate Offline
- R8D consumida observou quote antes do primeiro heartbeat: entrega EUR/USD é possível, mas heartbeat causal e confiabilidade contínua não foram provados; R8C segue sem causa.
- `twelve-ws-provider-readiness-v1` avalia somente evidência sanitizada, deduplica por conteúdo canônico e falha fechado para raw/segredo/malformed. Não possui rede.
- Fixture R8C+R8D = `INTERMITTENT_BEHAVIOR_OBSERVED`, sem commissioning/PAPER/Champion/dashboard/ordem/merge. R8E externa não autorizada.
- Audit fix: `latest*` usa a última evidência na ordem de entrada após deduplicação; não fabrica recência por ordenação canônica.
