# WILL TRADER — Auditoria de Base para Reconstrução

Data: 2026-11-08  
Repositório: `KaioBittencourt07/will-trader`  
Branch de reconstrução: `rebuild/will-trader-foundation-2026-11-08`  
Base preservada: `codex/will-3-handoff-20260902`  
Commit-base: `1ab7dd7c876e7f1a9ce7e2bde99f72aee8e16d74`

## 1. Decisão de engenharia

A reconstrução começa em uma branch isolada. Nenhuma branch existente será apagada, nenhum dado será migrado e `main` não será alterada nesta etapa. A branch-base foi escolhida porque contém a versão remota mais recente identificada nesta auditoria (445 caminhos no Git tree, commit de 2026-10-30) e preserva os módulos de dados, inteligência, PAPER, aprendizado, dashboard e testes.

## 2. Inventário confirmado no GitHub

- Backend Node.js/Express e API de análise, mercado, contexto, histórico, oportunidades, PAPER, pesquisa e execução manual.
- Data layer com Market Data Engine, universo de ativos, adapters, Twelve Data REST/WebSocket, Oanda, Coinbase temporal, Biquote e composição multi-provider.
- Núcleo determinístico: Data Guard, Feature Engine, Market Regime, Setup Classifier, Opportunity Engine, No-Trade, timing, pipeline e gestão de risco.
- IA: OpenAI e revisores opcionais Grok/Claude em `backend/src/ai/advisors.js`. A IA é auditor/validador; não pode liberar um sinal bloqueado pelo motor determinístico.
- Aprendizado: history store, Error Bank, outcome resolver, métricas, experimentos, drift detection, WILL LAB e evidência prospectiva.
- Backtest/replay e PAPER com separação da execução manual.
- Dashboard existente em `dashboard/index.html` e `dashboard/api.js`.
- Testes distribuídos em `tests/`, `data/src/` e `backend/src/`.
- Documentação extensa em `docs/`, incluindo arquitetura, roadmap, providers, market access, PAPER, OOS e regras de segurança.

## 3. Universo e princípios já definidos

Universo configurado: 12 pares Forex (EUR/USD, GBP/USD, USD/JPY, USD/CHF, AUD/USD, NZD/USD, USD/CAD, EUR/GBP, EUR/JPY, GBP/JPY, AUD/JPY e CAD/JPY) e BTC/USD, ETH/USD e SOL/USD. A rotação é limitada por lote; ativo sem feed válido permanece indisponível.

Regras preservadas:
- BUY/SELL/WAIT; WAIT é decisão válida.
- Dados atrasados, incompletos, inconsistentes ou sem proveniência bloqueiam a decisão.
- Score/confiança heurísticos não são probabilidade calibrada.
- Registrar também WAIT, manter histórico prospectivo e evitar look-ahead.
- Não alterar thresholds para aumentar frequência.
- Não ajustar estratégia com base em operação isolada.
- PAPER/MANUAL primeiro; sem auto-click ou ordens reais.

## 4. Persistência: achado importante

Na branch-base, a persistência observada é baseada em arquivos JSON:
- histórico: `WILL_HISTORY_FILE`, padrão `data/will-history.json`;
- memória de pesquisa: `WILL_RESEARCH_FILE`, padrão `data/will-research.json`;
- estado do monitor PAPER: `WILL_PAPER_MONITOR_STATE_FILE`, padrão `data/will-paper-monitor-state.json`.

Não foi encontrada integração SQL/ORM, schema ou migration do WILL nessa árvore. Nas conexões de banco atualmente disponíveis, o projeto Supabase visível é `remote-link` e o projeto Neon visível é `logicore-ai-production`; nenhum deles está identificado como banco do WILL. Portanto, **não conectar, substituir, criar ou migrar banco nesta fase**. O banco externo mencionado pelo operador ainda precisa ser identificado antes de qualquer alteração de persistência. Os arquivos JSON existentes também não devem ser apagados.

## 5. Avalon

Foram localizadas branches experimentais separadas `feat/avalon-data-bridge` e `feat/avalon-live-readonly`, com documentação e protótipos próprios. A branch-base atual não contém um adapter Avalon integrado ao pipeline principal. A integração deve permanecer read-only/manual e só poderá ser considerada após auditoria das branches e validação explícita; não contornar autenticação nem automatizar cliques.

## 6. Divergência do workspace local — NÃO DESCARTAR

Contexto reportado em 2026-11-08:
- workspace Windows: `C:\Users\skdri\will-trader-git`;
- branch local: `codex/will-3-handoff-20260902`;
- HEAD local reportado: `be60db7`;
- ref remota reportada: `1ab7dd7`;
- working tree local contém alterações não commitadas e arquivos não rastreados, incluindo mudanças relacionadas a oportunidades, Market Data Engine, diagnósticos Twelve Data, testes, latência e estado local.

O conteúdo integral dessas alterações locais não está disponível pelo conector GitHub. Esta branch de reconstrução parte do commit remoto conhecido e **não incorpora nem apaga** as alterações locais. É proibido executar reset, clean, rebase, merge ou push forçado no workspace local até que o diff local seja preservado e reconciliado.

## 7. Qualidade e CI — problema identificado

O root `package.json` define `npm test` como `node --test tests/*.test.js`, mas o workflow atual instala dependências em `backend/` e executa `npm test` somente dentro de `backend/`. Assim, a suíte principal de `tests/` não é explicitamente executada pelo CI atual. Além disso, o workflow original só dispara push em `main`, não em branches de trabalho.

A primeira correção desta branch é fazer o CI executar as suítes raiz e backend, em branches e pull requests, sem remover ou enfraquecer testes.

## 8. Bloqueios conhecidos para validação

- O problema local recente inclui `RangeError: Invalid time value` em teste de Twelve Data ao interpretar `latestCandle.datetime`; a correção de timezone/timestamp precisa ser reproduzida na branch de reconstrução antes de ser considerada resolvida.
- Histórico de HTTP 429 no scanner Twelve Data exige cache, deduplicação, cooldown e respeito a Retry-After; não usar dados coletados sob rate-limit para tuning.
- A saúde de providers, a integração Avalon, a persistência do banco externo e a prontidão PAPER em runtime ainda precisam de evidência atual. Código presente não equivale a serviço operacional.

## 9. Próximas ações

1. Corrigir CI e obter execução real da suíte completa.
2. Reconciliar os arquivos locais não commitados sem sobrescrevê-los.
3. Executar baseline dos testes e classificar falhas preexistentes.
4. Auditar persistência e identificar o banco externo mencionado.
5. Auditar providers/timestamps e reproduzir o bug Twelve Data.
6. Auditar dashboard e manter seu fluxo visual aprovado.
7. Só então implementar correções por módulo, com commits pequenos e evidências.

## 10. Critério de verdade

Nenhuma fase será marcada como concluída apenas por existir código. A conclusão exige teste executado, resultado do CI, contrato documentado, diff revisado e limitações explícitas.
