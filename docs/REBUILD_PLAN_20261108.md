# WILL TRADER — Plano de Reconstrução Controlada

## Objetivo

Entregar uma plataforma de análise multiativo estável e utilizável em PAPER/MANUAL, reaproveitando os módulos comprovadamente úteis e eliminando ciclos de correção sem diagnóstico. O trabalho é feito em branch isolada; `main` permanece intacta até revisão.

## Fases e critérios de aceite

### Fase 0 — Preservação e baseline
- Preservar a branch remota atual e o workspace local com alterações não commitadas.
- Reconciliar diferenças local/remoto por diff; nunca usar reset/clean para "resolver" divergência.
- Identificar arquivos de estado e históricos antes de qualquer operação.
- Registrar commit, runtime, comandos e falhas do baseline.
- Aceite: inventário de arquivos e dados reconciliado; nenhuma perda de histórico.

### Fase 1 — Engenharia e CI
- Rodar a suíte raiz `tests/*.test.js` e testes do backend.
- Fazer CI executar ambas as suítes em branches e pull requests.
- Adicionar validação de sintaxe/format quando aplicável, sem mascarar testes.
- Aceite: checks automáticos reproduzíveis e relatório distinguindo falha preexistente de regressão.

### Fase 2 — Dados e providers
- Auditar contrato de snapshot, candle fechado, quote, timestamp, timezone e proveniência.
- Corrigir parsing de timestamp de forma determinística e cobrir ISO, UNIX e timezone explícito.
- Revisar cache, in-flight dedup, limiter, cooldown, Retry-After, timeout e telemetria.
- Avaliar Twelve Data, Coinbase, Biquote e Oanda separadamente; sem retry cego ou excesso de chamadas.
- Aceite: fixtures determinísticas, testes de freshness/invalid/stale/429 e health sem inventar dados.

### Fase 3 — Cérebro e decisão
- Mapear os módulos atuais antes de refatorar.
- Separar direção, qualidade da oportunidade, confiança heurística e probabilidade calibrada.
- Garantir que AI advisors só auditem/confirmem/vetem; nunca elevem decisão bloqueada.
- Preservar Risk Engine, No-Trade, circuit breaker, payout/break-even e bloqueios de dados.
- Aceite: testes de consenso, bloqueio, conflito, WAIT e razão explicável; nenhuma mudança de estratégia sem hipótese e versão.

### Fase 4 — Persistência e memória
- Identificar formalmente o banco externo existente, proprietário, projeto, schema e credenciais via secret manager.
- Comparar banco externo com JSON stores atuais e verificar integridade/contagem de registros.
- Planejar backup, migração idempotente, rollback e verificação antes de executar qualquer DDL ou mover dados.
- Preservar Error Bank, decision memory, history store, research memory e evidência prospectiva.
- Aceite: leitura/escrita comprovada e reconciliação de contagens; sem perda/duplicação e sem expor segredos.

### Fase 5 — Scanner e multiativo
- Preservar universo de 12 Forex + BTC/ETH/SOL.
- Scanner rotativo, lote limitado, rankeamento só com snapshots válidos e motivos de indisponibilidade.
- Respeitar budgets, cooldowns e diferenças de cobertura por provider.
- Aceite: testes de rotação, dedup, ranking determinístico, falhas de provider e bloqueio de ativo sem feed.

### Fase 6 — Dashboard
- Manter identidade e estrutura visual já aprovadas.
- Conectar status de backend/providers, radar multiativo, melhor oportunidade, BUY/SELL/WAIT, score, confiança heurística, setup/regime, timing, blockers, histórico e métricas.
- Não mostrar probabilidade calibrada enquanto não houver calibração fora da amostra.
- Aceite: fluxo completo no navegador com estados online/offline, loading, erro, vazio e dados PAPER claramente identificados.

### Fase 7 — PAPER e validação estatística
- Validar entrada/expiração com timestamps reais, settlement idempotente e estado imutável.
- Medir cobertura, N, WIN/LOSS/TIE/DATA_INVALID, WAIT rate, intervalos e segmentação.
- Backtest temporal/walk-forward e Champion/Challenger sem contaminar evidência congelada.
- Aceite: soak PAPER pré-registrado, logs sanitizados e nenhuma alegação de edge sem amostra adequada.

### Fase 8 — Operação e entrega
- Deploy reproduzível, health/readiness, observabilidade, backups e rollback.
- Runbook de inicialização, variáveis necessárias, troubleshooting e recuperação.
- Aceite: ambiente PAPER validado de ponta a ponta, testes verdes e bloqueios restantes listados.

## Automação permitida

- GitHub Actions para testes em push/PR.
- Branches isoladas, commits pequenos e PRs revisáveis.
- Diagnóstico automatizado, logs redigidos e relatórios de causa raiz.
- Limite de duas tentativas de correção por defeito antes de parar e reavaliar.

## Limites

- Sem ordem real, auto-click ou bypass de autenticação Avalon.
- Sem modificar thresholds congelados ou evidência histórica para "passar".
- Sem alterar banco ou apagar arquivos de histórico sem backup e autorização específica.
- Sem expor API keys, cookies, tokens, payloads privados ou dados pessoais.
- Sem declarar sistema pronto sem teste/CI/runtime comprovados.
