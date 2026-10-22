# Protocolo de validação de mercado — WILL TRADER

## Objetivo e limite da alegação

Este protocolo busca confirmar ou refutar uma hipótese de edge com evidência temporal reproduzível. Uma CI verde demonstra comportamento do código sob teste; **não demonstra rentabilidade**. Um relatório que passe nos controles de formato também não autentica a procedência dos preços.

O replay implementado em `backtest/src/marketValidation.js` é descritivo. Seu campo `edgeProven` permanece `false` em qualquer resultado. Mesmo com amostra grande e expectativa positiva, uma revisão estatística independente ainda é necessária antes de considerar promoção de estratégia.

## Dados obrigatórios

Para cada observação, exigir:
- ativo/símbolo normalizado;
- preço positivo e finito;
- timestamp ISO-8601 com `Z` ou offset explícito;
- fonte/provedor e método de coleta registrados separadamente;
- evidência de que a série corresponde ao ativo/mercado alegado e não sofreu transformação não documentada.

O validador recusa horários sem fuso, preços inválidos e timestamps duplicados para o mesmo ativo. Não “limpa” silenciosamente o dataset para melhorar os resultados. A validação de formato não verifica autenticidade ou licença do provedor.

Para cada decisão, registrar também WAIT/BLOCKED, ativo, direção, timestamp, versão da estratégia, snapshot de entrada, razões e decisão de executabilidade. Nunca analisar apenas os sinais que viraram WIN/LOSS; isso esconderia cobertura, seletividade e bloqueios.

## Como o replay resolve uma operação hipotética

1. A entrada usa a primeira observação do ativo **estritamente depois** do timestamp da decisão e respeita o atraso configurado.
2. O alvo de expiração é calculado a partir do timestamp efetivo daquela entrada.
3. O preço de resolução usa a primeira observação em ou depois do alvo. O atraso real até essa observação é reportado.
4. Ausência de cotação de entrada ou de expiração produz `UNRESOLVED`, nunca um resultado inventado.
5. BUY vence apenas se o preço de saída for maior; SELL vence apenas se for menor; preço igual é TIE.
6. PnL e expectativa financeira ficam indisponíveis quando não foi fornecido o payout. Com payout informado, o relatório identifica custos e payout assumidos.

Este modelo não prova o preço de preenchimento em uma corretora. Spread, slippage, atraso de rede, payout histórico efetivo, suspensão de mercado e regras de liquidação precisam de dados independentes e/ou modelos validados. O modelo atual usa um payout escalar por execução; se o payout varia por ativo/horário, segmente por payout confirmado antes de comparar resultados.

## Validação fora da amostra

1. Congelar a hipótese, parâmetros, versão do motor, ativos, timeframe, duração de expiração, payout e métricas primárias antes do teste.
2. Dividir por tempo em treino, validação e teste final; jamais embaralhar aleatoriamente uma série temporal.
3. Manter observações com o mesmo timestamp no mesmo split. Configurar `embargoMs` no mínimo compatível com o maior horizonte de expiração/rotulagem e atrasos aplicáveis. O split rejeita timestamp inválido e dados insuficientes para criar três segmentos.
4. Usar o conjunto de teste final uma única vez por hipótese congelada. Ajustes posteriores criam nova versão e exigem novo período prospectivo.
5. Comparar contra baseline simples e contra WAIT; medir cobertura, WIN/LOSS/TIE, taxa binária, payout, expectativa líquida, drawdown, sequência de perdas, dados não resolvidos e estabilidade por ativo/sessão/regime.
6. Reportar intervalo de Wilson de 95% como intervalo binomial descritivo por operação. Ele não corrige dependência serial, múltiplos testes ou seleção de estratégia; usar análise por blocos/ciclos quando apropriado.
7. Se o feed tiver HTTP 429, lacunas, preços stale, timestamp ambíguo, payout desconhecido, amostra contaminada ou outcomes não resolvidos, marcar o relatório incompleto e não promover a estratégia.

## Critérios para falar em evidência favorável

Um resultado só pode ser descrito como **evidência favorável preliminar** se todos os itens forem verdadeiros:
- procedência/licença e integridade do dataset verificadas;
- payout/custos e modelo de fill documentados;
- regras de entrada, expiração e timezone reproduzíveis;
- nenhuma contaminação temporal ou vazamento de futuro;
- teste prospectivo/holdout não usado em tuning;
- número de operações e cobertura divulgados;
- expectativa líquida positiva e intervalo/uncertainty apresentados;
- drawdown e sequência de perdas compatíveis com limites definidos antes do teste;
- resultado comparado ao baseline e replicado em outro período ou validação walk-forward.

Mesmo assim, não se deve prometer lucro nem chamar score heurístico de probabilidade calibrada. Um resultado negativo ou inconclusivo é válido e deve ser preservado.

## Estado desta implementação

O CI usa dados sintéticos exclusivamente para verificar as regras do replay e não consulta a TwelveData nem usa chaves reais. Portanto, não é uma análise de mercado atual nem comprovação de edge do WILL. Para o estudo real será necessário fornecer/configurar um dataset histórico verificável ou credenciais autorizadas do provedor e arquivar o dataset bruto com hash, janela temporal e fonte. A operação da Avalon continua MANUAL/PAPER, sem auto-click ou ordens reais.
