# WILL TRADER — Delta Report (2026-09-02)

## Escopo e fontes comparadas

- **GitHub `main`:** `3141e8fe8f0b34f75b4acb7b67e205774253b79e` (2026-08-26), conforme o handoff.
- **GitHub handoff:** `codex/will-3-handoff-20260902` / PR #1, quatro documentos de arquitetura sem mudança da lógica do bot.
- **Workspace ativo:** `work/will-trader`, versão local usada pelo backend em `http://127.0.0.1:3101/dashboard/`.

O workspace não possui metadados `.git`; portanto esta reconciliação é estrutural e comportamental, não um diff Git linha a linha. Nenhum `.env`, histórico de operação ou `node_modules` participa desta comparação.

## Baseline verificado no workspace

- Suíte Node executada antes desta reconciliação: **77 testes aprovados**.
- Backend PAPER/MANUAL ativo na porta 3101.
- Nenhuma integração de ordem real ou auto-click Avalon foi encontrada.
- Métricas locais no instante da inspeção: 101 observações; 31 rejeições de dado; 34 WAITs estratégicos; 36 candidatos direcionais; 11 operações liberadas; 2 outcomes manuais. Esta amostra não é evidência de edge e não foi usada para tuning de threshold.

## Delta: capacidades presentes no workspace e ausentes/anteriores no `main`

| Área | Estado local reconciliado |
| --- | --- |
| Market Data Engine | Cache por ativo/timeframe, deduplicação in-flight, rate limit, batch provider, telemetria e proteção de relay local contra 429/404. |
| Data quality | Normalização de snapshot, bloqueio de dado inválido/stale, deferimento de mercado fechado e WAIT auditável. |
| Scanner | Universo rotativo Forex/Cripto/Ações, scanner seletivo limitado, ranking somente de candidatos executáveis e explicação de WAIT. |
| Features | Provider TwelveData com candles/quote; modelo `relative-noise-v1` para trend, momentum e regime de volatilidade relativo ao ativo. |
| Decisão | Regime, setup, No-Trade, timing manual de 1–5 minutos, ranking por confiança/score/confirmações/contexto/frescor. |
| Evidence store | Histórico persistente de BUY/SELL/WAIT com preço, regime, setup, confirmações, data quality, clickTime, contexto e outcome. |
| Outcome | Resolução PAPER prospectiva após expiração e fluxo manual que exige confirmação da entrada real antes de WIN/LOSS. |
| Metrics | WIN/LOSS, segmentação por ativo/regime/setup/timeframe/hora, WAIT rate, funil operacional e proveniência de outcomes. |
| Guardrails | Confidence/score permanecem heurísticos; calibração só após amostra mínima; Avalon manual-only; IA apenas auditoria/veto. |
| Testes | Cobertura para cache, dedup, rate limit, batch, stale data, history, outcome, ranking, timing, AI consensus e feature normalization. |

## Lacunas contra a arquitetura alvo

1. **Versionamento de estratégia/evidência:** faltam `strategyVersion`/`modelVersion`, feature snapshot completo e um store append-only formal.
2. **Provider observability:** telemetria existe, mas ainda faltam retries/backoff com jitter, latency por provider, contadores de 429 persistentes e uma política formal de fallback.
3. **Outcome resolver:** precisa evoluir para idempotência explícita, TIE/UNRESOLVED/DATA_INVALID e registrar integralmente a qualidade do dado de resolução.
4. **Métricas científicas:** faltam intervalos de confiança, expectancy condicionada a payout/custos, filtros por versão de estratégia e segmentação por sessão/data-quality.
5. **Feature/Setup 2.0:** breakout, rejection, pullback, reversal, candle anatomy, suporte/resistência e sessão ainda não possuem derivação quantitativa robusta.
6. **Multi-timeframe:** existe contexto e endpoint experimental, mas não está integrado ao scanner final devido ao orçamento de chamadas do feed.
7. **Timing operacional:** um sinal de 1 minuto usado até cinco minutos depois precisa de revalidação imediatamente antes do clique; o fluxo atual não dispara essa segunda leitura automaticamente.
8. **WILL LAB:** faltam registry de experimento, temporal walk-forward, shadow/champion-challenger, drift detection e calibration out-of-sample.

## Decisões preservadas durante a reconciliação

- PAPER/MANUAL continua sendo o único modo operacional.
- Não há auto-click, ordem real ou integração Avalon nesta rodada.
- Nenhum threshold foi reduzido para aumentar frequência de trades.
- Nenhum score/confidence é denominado probabilidade calibrada.
- Resultados com feed degradado/429 não serão usados como prova de performance ou para tuning.

## Próxima fase aprovada

Executar **WILL 3.0-C/D incrementalmente** sobre o workspace reconciliado:

1. adicionar versão de estratégia e evidência imutável aos novos registros;
2. tornar outcome resolver explicitamente idempotente e completo;
3. adicionar métricas de amostra/intervalo/coverage por versão;
4. manter Multi-Timeframe em modo experimental até existir orçamento seguro de dados e hipótese versionada.

## Nota de sincronização

O Git local disponível neste ambiente não possui o helper HTTPS, portanto não foi usado para sobrescrever ou clonar a árvore. A publicação do workspace deve ser feita pela conexão GitHub autenticada em commits revisáveis na branch da PR, sem incluir segredos, histórico local ou dependências.
