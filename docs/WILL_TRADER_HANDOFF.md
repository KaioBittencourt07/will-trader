# WILL TRADER — handoff de validação e próximos passos

## Atualização de auditoria — 2026-10-29 (última execução)

- PR #8 (draft, aberto): validação de parâmetros `outputsize` e `timeframe(s)` com HTTP 400 antes de qualquer chamada do provedor. Push CI: https://github.com/KaioBittencourt07/will-trader/actions/runs/40964918765 — **sucesso**; PR CI: https://github.com/KaioBittencourt07/will-trader/actions/runs/40964922362 — **sucesso**, no commit `73ea1da4969644f8ce7842a72738547d64210119`.
- PR #9 (draft, aberto): implementa `GET /api/market/sources` como endpoint somente leitura e painel português no dashboard. Exibe estados das fontes sem iniciar sondagens externas; Binance segue `IMPLEMENTED_NOT_PROBED` e Avalon `NOT_CONNECTED`. A classificação REST também separa `PROBE_IN_PROGRESS` de falha confirmada. Push CI: https://github.com/KaioBittencourt07/will-trader/actions/runs/40966486673 — **sucesso**; PR CI: https://github.com/KaioBittencourt07/will-trader/actions/runs/40966493516 — **sucesso**, no commit `fd57bf797a44940ad0af1c13afb6e94eb703b3d2`. Inclui checagem automática da sintaxe do módulo JavaScript embutido no HTML do dashboard.
- Os CIs dos PRs #8 e #9 passaram por testes do backend, regressão completa, build Docker e smoke test. O CI do PR #9 também verifica a sintaxe do módulo JavaScript embutido no HTML do dashboard. Isto valida o código automatizado no commit testado, não conexão real de mercado nem rentabilidade.

- CI #688 (push): https://github.com/KaioBittencourt07/will-trader/actions/runs/40934678540 — **sucesso**; CI #689 (pull request): https://github.com/KaioBittencourt07/will-trader/actions/runs/40934685470 — **sucesso**, ambos no commit `b1f26d93610706b5cadd1198ec42caee2660d8b1`.
- A CI valida o patch de timestamp em `backtest/src/marketValidation.js` e `backtest/src/datasetManifest.js`; a causa de uma execução anterior falhar foi um regex com escape duplicado, corrigido antes da execução #688.
- PR #2: escopo dos patches restrito aos caminhos solicitados; CI #676 aprovada. O ciclo de reparo segue dependente de adapter real para isolamento e execução, não deve ser chamado de agente autônomo completo.
- Estado dos PRs #2, #5, #6, #8 e #9: abertos em draft, sem merge.
- Pendências bloqueantes continuam: validar o ambiente Windows local, provar feed real somente leitura, integrar/validar Avalon sem inventar cotação, coletar histórico somente após autorização de créditos, e executar PAPER prospectivo com custos/payout e proveniência.

Atualizado em: 2026-10-29  
Estado: **pronto para continuar a implementação, não pronto para uso real**.

Este documento reúne o estado verificado no GitHub e prepara a próxima sessão de codificação. Não substitui a validação do ambiente local Windows.

## Guardrails obrigatórios

- Não fazer merge nem deploy sem pedido explícito.
- Não realizar trades reais nem habilitar execução automática de ordens.
- Não consumir créditos pagos nem fazer coleta histórica real sem autorização explícita.
- Nunca colocar API keys, tokens ou cookies em logs, issues, commits ou relatórios.
- Não afirmar que uma fonte está conectada sem uma observação recente comprovada.
- Manter `edgeProven=false` até existir validação independente fora da amostra e evidência prospectiva adequada.

## Evidência confirmada

- CI #667 (push): https://github.com/KaioBittencourt07/will-trader/actions/runs/40930047712 — sucesso.
- CI #668 (pull request): https://github.com/KaioBittencourt07/will-trader/actions/runs/40930054281 — sucesso.
- As duas execuções passaram pela etapa `Verify Twelve Data provider offline`, testes backend, regressão completa, build Docker e smoke test.
- A verificação offline usa `node --check` no provider e testes focados com mocks. Não chama APIs externas nem consome créditos.
- Issue de acompanhamento: https://github.com/KaioBittencourt07/will-trader/issues/7.
- PRs relacionados: [#2 agente](https://github.com/KaioBittencourt07/will-trader/pull/2), [#5 replay/backtesting](https://github.com/KaioBittencourt07/will-trader/pull/5), [#6 verificação offline](https://github.com/KaioBittencourt07/will-trader/pull/6), [#8 validação de parâmetros](https://github.com/KaioBittencourt07/will-trader/pull/8), [#9 status das fontes + painel](https://github.com/KaioBittencourt07/will-trader/pull/9). Todos permanecem abertos em draft; não foram mesclados.

## O que CI verde NÃO comprova

- Que a cópia local do provider está sincronizada/correta ou que o backend local sobe.
- Que Twelve Data ou outro feed está autenticado e fornecendo dados recentes.
- Que Avalon está conectado; se não houver evidência, a fonte deve permanecer `NOT_CONNECTED`.
- Que o backtest usa dados históricos autenticados ou que não há leakage em todos os caminhos.
- Que há edge, expectativa positiva ou rentabilidade. O manifesto PAPER informa payout/custos como indisponíveis.

## Próximo passo local (sem chamadas externas)

No PowerShell, a partir da pasta `backend` do projeto:

```powershell
node ..\scripts\verify-local-market-provider.mjs
```

Cole a saída integral no chat, removendo qualquer segredo caso apareça. Esse comando deve permanecer offline.

Depois, testar o backend local de acordo com os scripts definidos no `backend/package.json` e verificar o endpoint de health configurado no projeto. Não presumir porta nem endpoint se a configuração local diferir.

## Ordem de trabalho para a próxima sessão

### A. Reprodutibilidade local
- [ ] Confirmar branch e commit local; verificar alterações locais antes de qualquer atualização.
- [ ] Rodar verificador offline do provider.
- [ ] Rodar testes backend e regressão.
- [ ] Iniciar backend e registrar health check sem expor ambiente/segredos.
- [ ] Corrigir apenas erros reproduzíveis e adicionar teste de regressão para cada correção.

### B. Observabilidade de feeds (read-only)
- [x] Implementar `/api/market/sources` e painel de status; CI aprovado no PR #9. Ainda falta validar a resposta em runtime após eventual merge/execução autorizada.
- [x] Preservar estados explícitos no código (`IMPLEMENTED_NOT_PROBED`, `NOT_CONNECTED`) e distinguir WebSocket conectado de tick fresco; CI aprovado. [ ] Confirmar em execução local com as configurações reais.
- [ ] Implementar diagnóstico seguro com timestamp, símbolo, idade do dado, provedor, latência e erro sanitizado.
- [ ] Não disparar chamadas reais de provider até existir autorização explícita para a política de créditos/credenciais.
- [ ] Para Avalon, usar somente dados acessíveis legitimamente em modo read-only; não burlar autenticação, controles ou proteções da plataforma.

### C. Agente de engenharia
- [ ] O `repairCycle` atual é um coordenador com adapter injetado; os testes usam mocks.
- [ ] Antes de ligar um runner real, provar worktree descartável, baseline reproduzível, allowlist de caminhos, checks obrigatórios, inspeção de diff, detecção de segredos e descarte de candidato rejeitado.
- [ ] Preservar revisão humana; nenhuma alteração autônoma em main, merge ou deploy.

### D. Backtesting e PAPER
- [ ] Separar fixtures sintéticas de datasets de mercado reais e documentar proveniência/licença/hash.
- [ ] Confirmar splits cronológicos TRAIN/VALIDATION/TEST/PROSPECTIVE e teste de invariância contra dados futuros.
- [ ] Usar quotes de entrada e expiração com timestamps válidos, sem resolução antes do vencimento.
- [ ] Registrar payout, custos, spread, slippage, fills e dados inválidos; sem esses campos, não calcular EV como se fosse confiável.
- [ ] Preservar `edgeProven=false` e não promover estratégia por resultados sintéticos ou retrospectivos.

## Critério de saída

Só reportar “validado” por item que tenha comando/teste executado e evidência registrada. Se um item depender da máquina do usuário, de credenciais ou de autorização para custos, deixar explicitamente bloqueado e pedir apenas a ação mínima necessária.
