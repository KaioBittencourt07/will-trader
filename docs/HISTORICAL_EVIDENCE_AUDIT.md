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
