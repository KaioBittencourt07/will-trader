# Auditoria de evidência histórica disponível — WILL TRADER

Data da auditoria documental: 22 de outubro de 2026.

## Limite da evidência disponível

Os resultados abaixo foram recuperados de recortes de saída de PowerShell/console guardados em conversas anteriores. Não são o arquivo bruto completo `backend/data/will-history.json`, não possuem um hash de origem arquivado junto aos recortes e não representam o estado atual do processo. Devem servir como sinal de risco e guia de investigação, não como uma auditoria contábil definitiva.

## Snapshot de 14 de setembro de 2026

Um recorte local reportou 330 registros no histórico, com o último `createdAt` em `2026-09-14T23:34:47.140Z`. Na amostra visível havia uma operação `CLOSED/WIN`, diversas operações `OPEN` e registros `WAIT/SKIPPED`. Essa amostra parcial não permite calcular uma taxa de acerto justa: operações abertas não são resultados, WAIT não é uma perda e o recorte não inclui os registros completos ou suas referências de liquidação.

## Snapshot OOS2T de 22 de setembro de 2026

Um recorte de `/api/oos2t/status` indicou:

- primeiro conjunto: 8 ciclos observados e selados; 0 inválidos; 6 completos e 2 incompletos;
- 12 registros `noTrade`, 0 `dataInvalid`;
- `formalAnalysisAllowed: false`.

O mesmo conjunto de logs mostrou um escopo `will-edge-gate-oos2t-v1` / `will-edge-gate-oos2t-20260921-v1` com 1 sinal verificado, 0 entradas capturadas, 0 liquidações, 1 pendente. Portanto, não havia base suficiente para a análise formal do primeiro conjunto de 50 ciclos nessa fotografia. Esse estado histórico não deve ser confundido com um teste estatístico já concluído.

## Snapshot de PAPER/settlement de 25 de setembro de 2026

Outro recorte reportou 6 sinais verificados, 0 entradas capturadas, 0 liquidações, 6 pendentes e nenhum WIN/LOSS/TIE ou DATA_INVALID resolvido até aquele momento. Os resumos de ciclo incluíam pelo menos um ciclo com 4 itens `PROVIDER_UNAVAILABLE` e outro com 4 registros e 2 decisões WAIT. Isso é evidência de que a disponibilidade do provedor e a completude do ciclo precisam entrar no scorecard de readiness, não apenas a taxa de acerto das operações resolvidas.

## Conclusão permitida

Os recortes históricos apontam três condições que precisam ser comprovadas com o dataset bruto:
1. fechar e resolver operações de forma temporalmente correta, sem contar `OPEN` ou `PENDING` como resultados;
2. preservar e explicar todos os WAIT, bloqueios, falhas do provedor e amostras incompletas;
3. completar o conjunto prospectivo exigido no contrato OOS antes de chamar a análise de formal.

Eles **não comprovam edge, rentabilidade nem estabilidade atual**. O histórico local está fora do Git por segurança/integridade e não foi disponibilizado como dataset bruto verificável nesta rodada. O novo coletor histórico grava dados brutos e manifestos, mas requer uma chave TwelveData autorizada e uma execução manual confirmada. A CI usa fixtures sintéticas; não foi feita uma chamada ao provedor durante os testes.

## Próxima verificação com artefatos reais

Quando o arquivo de histórico local estiver disponível, validar seu SHA-256, esquema, duplicatas, status e timestamps; reconciliar a contagem com os registros oficiais pré-corte congelados; revisar as entradas e liquidações apenas para a campanha exata; e executar replay temporal com os preços históricos licenciados. Não atualizar hashes/thresholds congelados só para obter PASS: divergências devem ser relatadas como divergências.

## Snapshot exploratório de quartis — transcrição de 15 de setembro de 2026

A transcrição `Texto colado(20260915-025748).txt` contém uma tabela `Show-Quartiles $allCycleResearch`. Ela reporta 103 ciclos divididos em quartis 26/26/26/25 e totaliza 93 WIN, 98 LOSS e 9 TIE (200 rótulos; 191 operações binárias). Os números abaixo são **a reprodução da transcrição**, não um novo cálculo sobre o dataset bruto:

| Métrica agrupadora | Quartil | Média da métrica no grupo | WIN | LOSS | TIE | WR entre WIN/LOSS |
|---|---:|---:|---:|---:|---:|---:|
| MeanAbsMomentum | Q1 | 0,220281 | 23 | 21 | 2 | 52,27% |
| MeanAbsMomentum | Q2 | 0,426042 | 24 | 20 | 3 | 54,55% |
| MeanAbsMomentum | Q3 | 0,628868 | 27 | 29 | 1 | 48,21% |
| MeanAbsMomentum | Q4 | 0,892642 | 19 | 28 | 3 | 40,43% |
| ReversalShare | Q1 | 0 | 21 | 24 | 3 | 46,67% |
| ReversalShare | Q2 | 0 | 20 | 31 | 2 | 39,22% |
| ReversalShare | Q3 | 0,025641 | 24 | 23 | 2 | 51,06% |
| ReversalShare | Q4 | 0,753333 | 28 | 20 | 2 | 58,33% |
| BreakoutShare | Q1 | 0 | 26 | 21 | 2 | 55,32% |
| BreakoutShare | Q2 | 0 | 16 | 25 | 2 | 39,02% |
| BreakoutShare | Q3 | 0,301282 | 25 | 28 | 5 | 47,17% |
| BreakoutShare | Q4 | 0,856667 | 26 | 24 | 0 | 52,00% |

A WR agregada reportada pode ser refeita aritmeticamente: (93/(93+98)=48,69\%). Um intervalo de Wilson **ingênuo por operação** é aproximadamente 41,70%–55,74%; isso não corrige dependência entre operações do mesmo ciclo, seleção de variáveis nem testes múltiplos. Para MeanAbsMomentum, combinar Q1+Q2 dá 47/88 = 53,41% (Wilson ingênuo 43,06%–63,47%) e Q3+Q4 dá 46/103 = 44,66% (Wilson ingênuo 35,42%–54,28%). Os intervalos se sobrepõem; essa diferença não prova que o filtro é rentável. Para Q4 de ReversalShare a WR é maior na tabela, mas o mesmo problema de seleção/multiplicidade continua.

Uma referência de payout ilustra por que WR bruta não basta: **se** o payout líquido de uma vitória fosse 80% da stake, sem comissão/custos e com TIE devolvendo a stake, o breakeven entre resultados binários WIN/LOSS seria 55,56% (`1 / (1 + 0,80)`). Neste snapshot, a WR binária agregada é 48,69% e Q1+Q2 de MeanAbsMomentum é 53,41%, ambos abaixo desse exemplo. O payout real da conta, por ativo e por horário **não está autenticado aqui**; esta comparação não é um cálculo de PnL nem de resultado atual.

Essas estatísticas são uma pista de pesquisa, **não uma validação OOS independente**. A transcrição demonstra que um script chamado `Show-Quartiles` rodou contra `$allCycleResearch`, mas não permite confirmar pela saída isolada quais IDs, campanhas, timestamps, estados oficiais ou partições temporais entraram. Não se deve inferir que esse snapshot corresponde ao protocolo posterior OOS2/OOS2T nem usar os quartis para ajustar thresholds congelados.

### Hipótese de trabalho documentada

Uma hipótese a validar — sem promoção automática — é se a magnitude do momentum e a composição de reversões mantêm associação com resultado depois de:
1. reconstruir os resultados dos 103 ciclos a partir do histórico bruto e dos IDs de ciclo;
2. verificar que WIN/LOSS/TIE vêm de liquidação temporal válida e que WAIT/UNRESOLVED/bloqueios foram preservados;
3. separar temporalmente um holdout que não participou da escolha dos fatores;
4. repetir o exame com bootstrap por ciclo e corrigir/incluir a multiplicidade de fatores investigados;
5. computar expectativa líquida com payout/custos observados, não só WR.

Enquanto o bruto e sua proveniência não forem verificados, os números acima devem ser apresentados como transcrição exploratória antiga. Não justificam ativação, tuning, Champion ou operação real.

