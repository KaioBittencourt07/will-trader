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
- histórico: WILL_HISTORY_FILE, padrão data/will-history.json;
- memória de pesquisa: WILL_RESEARCH_FILE, padrão data/will-research.json;
- estado do monitor PAPER: WILL_PAPER_MONITOR_STATE_FILE, padrão data/will-paper-monitor-state.json.

O .gitignore exclui /backend/data/; portanto, esses arquivos de runtime não fazem parte do Git tree e não foram copiados para a branch nova. Eles podem conter o histórico real do usuário e precisam ser preservados/verificados separadamente antes de qualquer deploy ou migração. Foi criado o comando `npm run backup:runtime-data`, que copia recursivamente backend/data para fora do repositório, gera manifesto SHA-256 e verifica cada cópia sem apagar ou alterar a origem. O comando deve ser executado no workspace local antes de qualquer deploy. Não foi encontrada integração SQL/ORM, schema ou migration do WILL nessa árvore. Nas conexões de banco atualmente disponíveis, o projeto Supabase visível é `remote-link` e o projeto Neon visível é `logicore-ai-production`; nenhum deles está identificado como banco do WILL. Portanto, **não conectar, substituir, criar ou migrar banco nesta fase**. O banco externo mencionado pelo operador ainda precisa ser identificado antes de qualquer alteração de persistência. Os arquivos JSON existentes também não devem ser apagados.

## 5. Avalon

Foram localizadas branches experimentais `feat/avalon-data-bridge` e `feat/avalon-live-readonly`. Nesta branch foi criado um parser `avalonReadOnlyFeed`, endpoint autenticado `/api/avalon/ingest`, status `/api/avalon/status` e script `tools/avalon-bridge.js`, com captura filtrada por host e apenas eventos `candle-generated`/`timeSync`. O parser valida OHLC e bid/ask, mas mantém `at/from/to/timeSync` como valores brutos com unidade `UNVERIFIED`. O feed permanece `SHADOW_ONLY`, sem impacto nas decisões e sem execução de ordens. O mapeamento de `active_id` para símbolo ainda não foi confirmado. O Local Relay HTTP é um mecanismo separado e não é Avalon. Instruções: `docs/AVALON_BRIDGE_SETUP.md`.

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
- A saúde dos providers e a prontidão PAPER em runtime ainda precisam de evidência atual. A ponte Avalon está implementada em SHADOW, mas depende de token local, sessão autorizada, captura real, mapeamento dos active_id e validação das unidades de tempo. A persistência externa do WILL ainda não foi identificada. Código presente não equivale a serviço operacional.


## 9. Baseline de testes e correções comprovadas

Na execução GitHub Actions de 2026-11-08, após corrigir o runner:
- suíte raiz + data layer: 776/776 aprovados;
- suíte backend: 22/22 aprovados;
- total: 798 aprovados, zero falhas e zero cancelamentos.

Causas corrigidas nesta branch:
1. O arquivo OOS-2 congelado teve CRLF convertido para LF pelo Git, quebrando o SHA-256. O conteúdo original foi restaurado byte a byte e .gitattributes agora preserva -text para esse arquivo. Threshold, cutoff, amostra e política não foram alterados.
2. O teste local de handshake WebSocket aguardava indefinidamente o evento close, que não é emitido em todos os runtimes Node quando o upgrade é rejeitado. O teste agora tem prazo curto, aceita somente os eventos observados e classifica ausência de status/close como inconclusiva.
3. O parser Twelve Data agora valida formato, calendário, timezone e faixa dos timestamps de candles/quotes antes de chamar toISOString(). Datas inválidas viram erro controlado, não RangeError: Invalid time value.
4. O Market Data Engine agora deduplica batches concorrentes idênticos antes de consumir outro slot do provider.
5. O fallback Local Relay agora é opt-in, exige endpoint independente, bloqueia autorreferência para a porta do backend e não fica preso em um latch permanente após falha. Ele não é o feed Avalon.
6. A integração Avalon SHADOW valida eventos, autentica o endpoint com token em tempo constante, restringe CORS ao endpoint de ingest e não assume unidades de timestamp.
7. O dashboard agora expõe candles por ativo, revisão manual de sinal, métricas de desempenho e auditoria manual de IAs. A auditoria não grava uma segunda linha no histórico e só roda quando acionada.
8. O CI também executa `node --check` nos módulos JavaScript do dashboard.

Execução aprovada: 42517946187 — https://github.com/KaioBittencourt07/will-trader/actions/runs/42517946187. A alteração posterior no teste de diagnóstico do endpoint Avalon aguarda nova execução.

## 10. Próximas ações

1. Preservar e recuperar os arquivos JSON locais e o canary de commissioning antes de qualquer deploy.
2. Identificar com o operador qual serviço/projeto contém o banco externo mencionado; não criar ou migrar banco por suposição.
3. Reconciliar o working tree Windows não commitado sem sobrescrevê-lo.
4. Executar o bridge Avalon numa sessão autorizada, confirmar active_id por símbolo e validar unidades de tempo com fonte independente.
5. Continuar auditoria de providers, integração de dados e comportamento do scanner em runtime.
6. Validar dashboard com backend real, IA sob demanda e persistência recuperada.
7. Fechar testes PAPER, risco e recuperação antes de qualquer operação real.

## 11. Critério de verdade

Nenhuma fase será marcada como concluída apenas por existir código. A conclusão exige teste executado, resultado do CI, contrato documentado, diff revisado e limitações explícitas.
