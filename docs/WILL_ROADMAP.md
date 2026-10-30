# WILL TRADER — Roadmap de Execução

## WILL 3.0 — Foundation & Evidence
Objetivo: tornar o sistema confiável para PAPER prospectivo e mensuração.

### Fase 3.0-A — Inspeção e baseline
- localizar workspace/ZIP mais recente;
- diff contra `main`;
- inventariar módulos/endpoints/scripts;
- rodar testes atuais;
- revisar secrets/.gitignore;
- gerar `docs/DELTA_REPORT_20260902.md`.

**DoD**
- baseline documentado;
- testes reproduzíveis;
- versão ativa identificada;
- nenhum secret exposto;
- diferenças entre GitHub e workspace conhecidas.

### Fase 3.0-B — Market Data Engine
- cache;
- in-flight dedup;
- rate limiting;
- retry/backoff;
- freshness/stale;
- provider health;
- data quality;
- telemetry.

**DoD**
- scanner repetido não dispara requisições duplicadas desnecessárias;
- testes provam cache e dedup;
- testes simulam 429/backoff;
- stale data é bloqueado ou explicitamente classificado;
- `/health` ou endpoint equivalente mostra provider/cache/rate-limit status;
- nenhuma mudança de thresholds de trading nesta fase.

### Fase 3.0-C — Evidence Store + Outcome Resolver
- persistência prospectiva;
- registrar WAIT;
- strategyVersion/modelVersion;
- snapshots/features imutáveis;
- outcome resolver idempotente e temporalmente correto.

**DoD**
- toda decisão gera registro;
- decisão original não muda após outcome;
- resolver não resolve antes da expiração;
- testes WIN/LOSS/TIE/UNRESOLVED/DATA_INVALID;
- reprocessamento não duplica outcome.

### Fase 3.0-D — Metrics
- N e coverage;
- WAIT rate;
- win/loss/tie;
- intervalo para win rate;
- segmentação;
- expectancy quando payout/custos conhecidos;
- blocker distribution.

**DoD**
- dashboard/API sempre mostra sample size junto da taxa;
- métricas podem ser filtradas por strategyVersion;
- nenhuma conclusão é tirada de amostra minúscula sem aviso;
- score heurístico não aparece como probabilidade.

### Fase 3.0-E — Selective Scanner / Ranker
- ranking multiativo;
- requisições controladas pelo Market Data Engine;
- candidatos bloqueados não promovidos;
- razão do ranking;
- registro de todos os candidatos analisados.

**DoD**
- scanner funciona sem 429 em cenário de teste controlado;
- ranking determinístico para snapshots iguais;
- #1 possui explicação;
- WAIT permanece resultado legítimo;
- nenhum threshold é afrouxado apenas para aumentar frequência.

## WILL 4.0 — Intelligence & Lab
Objetivo: testar hipóteses mais inteligentes sem contaminar Champion.

### Fase 4.0-A — Feature/Setup Engine 2.0
- breakout/rejection/pullback/reversal objetivos;
- candle anatomy;
- ATR/volatility/structure;
- support/resistance;
- session/time features.

### Fase 4.0-B — Multi-Timeframe
- combinações versionadas;
- alinhamento/divergência;
- comparação contra single-timeframe baseline.

### Fase 4.0-C — Probability Calibration
Somente quando histórico confiável for suficiente.
- reliability analysis;
- calibration bins;
- isotonic/logistic/Platt quando adequado;
- Brier/log loss;
- out-of-sample calibration.

### Fase 4.0-D — WILL LAB
- temporal backtest/replay;
- forward paper;
- walk-forward;
- shadow strategies;
- champion/challenger;
- experiment registry.

### Fase 4.0-E — ML tabular
Somente se baseline e dados justificarem.
Primeiros candidatos:
- logistic regression/regularized linear models;
- tree ensembles;
- gradient boosting.

Deep learning não é prioridade inicial.

### Fase 4.0-F — Drift & Adaptive
- feature/performance drift;
- bounded adaptive weights;
- shadow-only adaptation antes de promoção;
- rollback.

**DoD geral WILL 4.0**
- qualquer challenger tem versão própria;
- avaliação temporal/out-of-sample;
- nenhuma promoção baseada só em in-sample;
- critérios de promoção definidos antes do teste;
- Champion permanece intacto durante experimento.

## WILL 5.0 — Execution Readiness
Objetivo: preparar execução real somente se edge e guardrails forem demonstrados.

### Fase 5.0-A — Execution abstraction
- interface genérica de broker/execution;
- PAPER continua adapter padrão;
- latency/slippage model;
- idempotency/order state machine.

### Fase 5.0-B — Safety
- kill switch;
- daily loss limit;
- consecutive-loss circuit breaker;
- provider degradation block;
- stale-data block;
- execution timeout;
- audit trail.

### Fase 5.0-C — Avalon adapter
Somente após decisão explícita futura e validação técnica/legal apropriada.
- leitura/integração deve ser separada da intelligence layer;
- nenhum bypass de autenticação;
- nenhum scraping de credenciais;
- sem auto-click enquanto não aprovado como fase futura.

**DoD WILL 5.0**
- edge prospectivo demonstrado dentro de critérios predefinidos;
- safety tests verdes;
- execution em sandbox/paper estável;
- observabilidade completa;
- rollback/kill switch testados;
- decisão explícita antes de qualquer real-money mode.

## Política de experimentos
Cada mudança de estratégia deve possuir:
- hipótese;
- strategyVersion;
- parâmetros congelados;
- período/amostra de avaliação;
- métricas primárias;
- critérios de sucesso/fracasso;
- resultado;
- decisão: REJECT / SHADOW / CHALLENGER / PROMOTE.

Nunca:
`LOSS -> alterar threshold -> LOSS -> alterar lógica -> WIN -> declarar melhora`.

Preferir:
`V1 congelada -> batch prospectivo -> análise -> hipótese -> V2 challenger -> comparação temporal`.

## Scorecard que deve acompanhar as entregas
- Tecnologia/arquitetura;
- Data quality/provider reliability;
- Signal intelligence;
- Risk/No-Trade;
- Test coverage;
- Statistical maturity;
- PAPER readiness;
- Real-money readiness;
- Principais bloqueadores.
