# WILL TRADER — CODEX HANDOFF

Data do handoff: 2026-09-02

## Missão
Assumir a próxima rodada de desenvolvimento do WILL TRADER sem perder o contexto técnico acumulado. O objetivo imediato NÃO é operar dinheiro real nem automatizar a Avalon. O objetivo é transformar o WILL em uma plataforma de decisão seletiva, mensurável e auditável em PAPER/MANUAL, capaz de demonstrar ou refutar edge estatístico prospectivamente.

## Estado conhecido
- Repositório GitHub: `KaioBittencourt07/will-trader`.
- O `main` visível no momento deste handoff ainda está no commit de 2026-08-26 `3141e8fe8f0b34f75b4acb7b67e205774253b79e`.
- A versão mais recente feita pelo usuário + Codex em 2026-09-02 pode existir apenas no workspace/local e foi referenciada como `will-trader-selective-scanner-20260902.zip` e dashboard em `http://127.0.0.1:3101/dashboard/`.
- Portanto, PRIMEIRA AÇÃO do Codex: localizar o workspace/ZIP mais recente, comparar com o `main` e produzir um delta report antes de alterar lógica.
- Base histórica local conhecida: `C:\Users\skdri\Downloads\TRADER-BOT--main\TRADER-BOT--main`.
- Backend histórico: Node.js/Express; `node --test`; porta 3000 em versão anterior.
- Provider histórico: TwelveData em `data/src/providers/twelveDataProvider.js`, usando `quote` + `time_series`.
- Problema real observado: TwelveData HTTP 429 em scanner multiativo. Resultados obtidos sob rate-limit NÃO devem ser usados para tuning.

## Decisões congeladas
1. PAPER/MANUAL primeiro. Nada de clique automático ou dinheiro real na Avalon nesta fase.
2. Não prometer lucratividade/assertividade. O sistema precisa provar ou refutar edge com dados prospectivos.
3. Não reduzir thresholds artificialmente para gerar mais trades.
4. Não alterar parâmetros após trade individual. Mudanças precisam ser versionadas e avaliadas em batches.
5. Registrar também WAIT, não somente BUY/SELL.
6. `confidence`/`score` atuais são heurísticos; NÃO chamar de probabilidade de vitória até existir calibração estatística.
7. OpenAI é auditor/validador/contextualizador; não deve mascarar fraqueza do motor quantitativo.
8. Grok permanece separado por enquanto como futura camada independente de contexto/auditoria. Não implementar votação simplista entre IAs.
9. Avalon permanece manual/read-only/discovery até decisão futura explícita.
10. Cache/rate-limit/data quality vêm antes de scanner agressivo/multi-timeframe pesado.
11. Evitar rewrite total; migrar incrementalmente e preservar APIs/testes quando possível.
12. LAB e PAPER/LIVE devem ser separados. Estratégia experimental não substitui a Champion sem evidência.

## Estado técnico conhecido da base anterior
### API
- `GET /api/market?asset=...&timeframe=1min`
- `POST /api/analyze`
- `GET /api/context`
- `GET/POST /api/paper` (dependendo da versão)
- `GET /health`

### Engine determinístico anterior
- Pesos: trend 0.35, momentum 0.30, structure 0.35.
- Direção: BUY se directional > 0.15; SELL se < -0.15; senão WAIT.
- Minimum score padrão: 70.
- Risk flags conhecidos: volatility > 0.85, confirmations < 3, abs(directional) < 0.15.
- NoTrade: bloqueia regime/setup desconhecido, alta volatilidade, baixa confiança, macro risk e dados inválidos.
- Regime: HIGH_VOL >= 0.85; LOW_VOL <= 0.15; directional = trend*0.6 + structure*0.4; UP >= 0.45; DOWN <= -0.45; RANGE abs <= 0.15; senão TRANSITION.
- Setup classifier: CONTINUATION, PULLBACK, BREAKOUT, REJECTION, REVERSAL, STRUCTURE, TREND, RANGE, UNKNOWN.
- Limitação conhecida: flags breakout/rejection/pullback/reversal não eram robustamente derivadas pelo provider, levando a muito UNKNOWN/STRUCTURE.

### Confirmações conhecidas
- trendSign se `abs(trend) >= 0.15`.
- momentumSign se `abs(momentum) >= 0.15`.
- structureSign se `abs(structure) >= 0.25`.
- MA alignment usa posição do last vs SMA5 e SMA12.
- directionalVotes = sinais acima.
- dominant só existe se `abs(voteSum) >= 2`.
- confirmations conta votos do lado dominante.
- NÃO aumentar artificialmente para 3.
- trend/momentum são indicadores normalizados (raw price change *100 clamp [-1,1]), não percentuais literais.

### Consensus/AI anterior
- AI precisa concordar com a direção determinística.
- AI confidence >= 70.
- Sem AI block.
- Determinístico precisa ser executable.
- Falha de consenso => WAIT e `AI_CONSENSUS_FAILED`.

### Testes conhecidos
A base anterior possuía 3 testes de consenso passando:
- aprova AI forte e alinhada;
- veta direção oposta;
- veta AI confidence fraca.

## Falhas/anti-patterns já identificados
- Integrar Avalon antes de provar o engine.
- Otimizar thresholds sem amostra.
- Tunar a partir de 1 trade.
- Confundir score com probabilidade.
- Usar resultados obtidos sob HTTP 429.
- Scanner multiativo sem cache/dedup/rate-limit.
- Setup detection baseado em flags fracas ou entradas manuais.
- Misturar dashboard, Avalon, WebSocket, IA e market-data na mesma rodada de mudanças.
- Overfitting, data snooping, leakage e random split em série temporal.
- Maximizar win rate ignorando payout/custos/expectancy.
- Omitir WAIT do histórico, destruindo a medição de seletividade/coverage.

## Ordem obrigatória de inspeção
1. Encontrar o workspace/ZIP mais recente de 2026-09-02.
2. Comparar tree/diff contra `main`.
3. Identificar backend ativo, porta, scripts e endpoints atuais.
4. Rodar testes existentes antes de alterar qualquer lógica.
5. Verificar `.gitignore`, `.env`, secrets, logs e frontend para impedir exposição de chaves.
6. Localizar implementação de cache/dedup/rate-limit e provar seu comportamento por testes/telemetria.
7. Localizar scanner seletivo e verificar se ranking usa dados reais e não valores artificiais.
8. Localizar paper/history store e confirmar se é prospectivo, persistente e inclui WAIT.
9. Localizar outcome resolver e checar look-ahead/leakage.
10. Localizar métricas e checar se sample size/segmentação estão corretos.
11. Localizar qualquer campo chamado `probability`, `accuracy` ou similar e verificar se é estatisticamente defensável. Renomear para score/confidence quando não for probabilidade calibrada.
12. Produzir `docs/DELTA_REPORT_20260902.md` antes da implementação estrutural.

## Primeira sequência de implementação
### P0 — Market Data Foundation
- cache por `provider:asset:timeframe`;
- in-flight request deduplication;
- rate limiting/concurrency control;
- backoff/retry para 429 respeitando limites do provider;
- freshness/stale detection;
- provider health e telemetry;
- data quality score;
- stale fallback apenas se explicitamente marcado e dentro de política segura;
- abstração de provider para futuro failover.

### P1 — Evidence Store
Registrar TODAS as decisões, inclusive WAIT, de forma persistente e versionada. Campos mínimos:
- decisionId;
- strategyVersion/modelVersion;
- asset;
- timeframe(s);
- provider;
- quoteTimestamp/candleTimestamp/decisionTimestamp;
- theoreticalClickTime;
- entryPrice teórico;
- expirySeconds/expiryTimestamp;
- direction;
- directionScore;
- opportunityScore/grade;
- confidence heurística;
- calibratedProbability somente quando existir;
- regime/setup;
- confirmations;
- blockers/reason codes;
- dataQuality;
- feature snapshot;
- provider health/latency;
- outcome status e resolution metadata.

### P2 — Outcome Resolver
- resolver outcomes somente após expiração;
- usar dado disponível após o evento, sem olhar o futuro durante decisão;
- distinguir WIN/LOSS/TIE/UNRESOLVED/DATA_INVALID;
- manter entry/expiry timestamps imutáveis;
- não permitir edição retroativa silenciosa;
- idempotência.

### P3 — Metrics
- sample size N;
- WIN/LOSS/TIE;
- win rate + intervalo de confiança;
- coverage e WAIT rate;
- métricas por asset/setup/regime/session/hour/data quality/strategy version;
- expectancy somente com payout/custos válidos;
- drawdown quando aplicável;
- Brier/log loss/calibration somente quando houver probabilidades reais/calibradas.

### P4 — Selective Scanner / Opportunity Ranker
- scanner deve reduzir chamadas, não explodir quota;
- ranking multiativo com somente snapshots válidos;
- Direction separado de Opportunity Quality;
- não promover ativo bloqueado pelo No-Trade;
- explicar por que o #1 é melhor que os demais;
- registrar candidatos e WAITs para medir coverage.

### P5 — Feature/Setup Quality
Derivar objetivamente dos candles:
- trend/momentum/structure/volatility;
- ATR/returns/range;
- MA relationships;
- candle anatomy;
- support/resistance;
- breakout/rejection/pullback/reversal;
- time/session features;
- opcionalmente liquidity-like features, com definição quantitativa clara.

### P6 — Multi-Timeframe
Implementar como hipótese testável, não como regra dogmática. Exemplo inicial possível:
- 15m contexto;
- 5m estrutura/setup;
- 1m trigger/timing.
Medir alinhamento/divergência e comparar versões.

### P7 — Statistical Calibration / WILL LAB
Somente após dataset suficiente e pipeline confiável:
- temporal splits;
- forward paper;
- walk-forward/out-of-sample;
- calibration curves;
- baseline vs challenger;
- modelos tabulares simples/regularizados e gradient boosting antes de deep learning;
- drift detection;
- bounded adaptive weights;
- champion/challenger/shadow mode.

## Definition of Done resumida
Uma fase só está concluída se:
- testes existentes continuam verdes;
- novos testes cobrem comportamento novo;
- API compatível ou migração documentada;
- telemetry mostra funcionamento real;
- nenhuma chave/secreto exposto;
- documentação atualizada;
- nenhum resultado fictício apresentado como performance;
- nenhuma mudança de threshold sem hipótese/documentação/evidência.

## Regras de segurança
- Nunca enviar ordens reais nesta fase.
- Nunca automatizar cliques na Avalon nesta fase.
- Nunca armazenar credenciais da corretora em frontend/localStorage/logs.
- Não versionar `.env`.
- Validar CORS/origin e endpoints mutáveis.
- Sanitizar logs e respostas de erro.
- Kill switches/circuit breakers precisam existir antes de qualquer futura execução.

## Entregável esperado do Codex ao fim de cada rodada
Responder com:
1. arquivos alterados;
2. arquitetura/delta implementado;
3. testes executados e resultado;
4. métricas/telemetria observadas;
5. riscos ainda abertos;
6. coisas explicitamente NÃO implementadas;
7. próximo passo recomendado;
8. commit/branch usado.

## PROMPT MESTRE PARA CODEX
Assuma o projeto WILL TRADER como executor técnico. Primeiro inspecione a versão mais recente disponível no workspace/local, incluindo qualquer `will-trader-selective-scanner-20260902.zip`, e compare contra `KaioBittencourt07/will-trader` main. Gere um delta report antes de modificar a arquitetura. Preserve os testes existentes e rode-os primeiro. Trabalhe incrementalmente, sem rewrite total.

Prioridades nesta ordem: (1) Market Data Engine robusto com cache, in-flight dedup, rate limiting, retry/backoff, freshness, provider health e data quality para impedir novos TwelveData 429; (2) store prospectivo e persistente de TODAS as decisões, inclusive WAIT, com strategy/model version e snapshots imutáveis; (3) Outcome Resolver idempotente e sem look-ahead; (4) métricas com N, win/loss/tie, intervalos, coverage/WAIT e segmentação; (5) scanner seletivo/opportunity ranking com dados reais e sem enfraquecer filtros; (6) feature/setup detection objetiva; (7) multi-timeframe como experimento versionado; (8) probability calibration somente após evidência; (9) WILL LAB, walk-forward, shadow/champion/challenger e drift; (10) execução/broker somente em fase futura.

Não chame score de probabilidade. Não altere thresholds para gerar mais trades. Não use resultados de scans afetados por 429 para tuning. Não prometa lucratividade. OpenAI é auditor/validador, não substituto de edge quantitativo. Grok fica fora do core por enquanto. Avalon permanece manual/read-only e sem auto-click. Sempre registrar WAIT. Sempre versionar mudanças de estratégia. Nunca tunar com base em um trade isolado.

Ao final de cada fase, informe arquivos alterados, testes, telemetria, riscos e próximo passo. Se descobrir que uma prioridade já está implementada na versão mais recente, primeiro prove por código/teste/telemetria; não reimplemente desnecessariamente.
