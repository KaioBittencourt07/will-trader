# WILL TRADER NEXT

> Intelligent Market Decision Engine

Novo núcleo do WILL TRADER. O objetivo é transformar o conhecimento acumulado em uma arquitetura limpa, mensurável, segura e evolutiva.

## Objetivo

Maximizar a qualidade das decisões e a expectativa matemática usando dados confiáveis, análise técnica, contexto macroeconômico, estatística, inteligência artificial e aprendizado contínuo.

**Importante:** não existe promessa realista de 100% de acerto. O sistema deve buscar vantagem estatística e, principalmente, saber quando não operar.

## Arquitetura

```text
MERCADO / DADOS
      ↓
DATA GUARD
      ↓
MARKET REGIME
      ↓
MULTI-TIMEFRAME
      ↓
SETUP CLASSIFIER
      ↓
TECHNICAL ENGINE
      ↓
MACRO ENGINE
      ↓
STATISTICAL ENGINE
      ↓
AI / GPT ENGINE
      ↓
RISK ENGINE
      ↓
NO-TRADE ENGINE
      ↓
DECISION ENGINE
      ↓
RANKING DOS ATIVOS
      ↓
EXECUÇÃO MANUAL
      ↓
WIN / LOSS / NÃO OPERADO
      ↓
ERROR BANK
      ↓
LEARNING ENGINE
      ↓
BACKTEST / EXPERIMENT LAB
```

## Princípios

- Nunca inventar cotação, candle, timestamp ou horário.
- Dados atrasados, incompletos ou inconsistentes bloqueiam decisões.
- **AGUARDAR** é uma decisão válida.
- O GPT é uma camada de raciocínio, não autoridade absoluta.
- O Risk Engine pode bloquear qualquer sinal.
- Toda decisão precisa ser explicável e registrada.
- Toda operação registra resultado.
- LOSS também é conhecimento.
- Amostra pequena não gera falsa confiança.
- Medir expectativa matemática, não somente WIN rate.
- Evitar overfitting.
- Alterações importantes devem ser testadas antes de produção.
- Execução automática só será considerada com infraestrutura segura e integração comprovada.

## Data Guard

Valida timestamp, atualização do feed, candles, valores impossíveis, mercado aberto/fechado, consistência entre fontes e integridade dos dados.

Falha de dados = **BLOQUEADO**.

## Market Regime

Classifica o ambiente atual: tendência, lateralização, alta/baixa volatilidade, pré-notícia, pós-notícia ou transição.

## Multi-Timeframe

Usa timeframe maior para contexto, timeframe operacional para setup e, quando disponível, timeframe menor para timing.

## Setup Classifier

Classifica continuação, pullback, rompimento, rejeição, reversão, tendência e lateralização. Cada setup terá estatística própria.

## Technical Engine

Analisa tendência, estrutura, momentum, volatilidade, suporte/resistência, rompimento, rejeição, exaustão, força da vela e alinhamento entre timeframes.

## Macro Engine

Considera juros, inflação, emprego, bancos centrais, calendário econômico, notícias de alto impacto e força relativa dos ativos.

Macro é contexto e filtro; não cria uma entrada sozinho.

## Statistical Engine

Calcula WIN rate, expectativa, break-even do payout, desempenho por ativo, horário, setup, regime e score, além de drawdown, sequências de perdas e tamanho da amostra.

## AI / GPT Engine

Recebe dados estruturados e devolve análise estruturada. A IA pode interpretar contexto, comparar evidências e explicar a decisão, mas não pode ignorar as regras determinísticas de risco.

Exemplo:

```json
{
  "asset": "EUR/USD",
  "direction": "BUY",
  "score": 0,
  "confidence": 0,
  "setup": "",
  "confirmations": [],
  "risks": [],
  "reason": "",
  "block": false
}
```

## Risk Engine

Pode bloquear por notícia de alto impacto, volatilidade extrema, estrutura indefinida, conflito entre timeframes, payout insuficiente, dados inconsistentes, comportamento fora do histórico ou risco anormal.

## No-Trade Engine

```text
Dados ruins             → BLOQUEAR
Risco alto              → BLOQUEAR
Setup fraco              → AGUARDAR
Confluência insuficiente → AGUARDAR
Vantagem estatística baixa → AGUARDAR
```

## Decision Engine

Somente após todas as validações pode produzir **COMPRA**, **VENDA** ou **AGUARDAR**. A saída deve conter ativo, direção, score, confiança, horário válido quando aplicável, confirmações, riscos e justificativa.

## Error Bank

Registra não apenas o resultado, mas o contexto e a provável causa de cada erro.

```text
LOSS
Setup: rompimento
Regime: lateralização
Causa: falso rompimento
```

## Learning Engine

Atualiza estatísticas e penalizações de forma controlada. Nenhuma regra deve se tornar permanente apenas porque melhorou uma amostra histórica.

## Experiment Lab

Toda mudança relevante deve ser comparada com a versão anterior usando dados fora da amostra de desenvolvimento.

```text
ENGINE A vs ENGINE B
WIN RATE
EXPECTATIVA
DRAWDOWN
AMOSTRA
ESTABILIDADE
```

## Circuit Breaker

Se o comportamento observado fugir significativamente do padrão esperado, o sistema entra em modo de proteção e pausa novas decisões para revisão.

## OpenAI API

A API será usada no backend. A chave **nunca** deve aparecer no HTML, JavaScript do frontend, GitHub Pages ou repositório público.

Fluxo:

```text
Frontend → Backend seguro → OpenAI API
```

O backend controla autenticação, limites, prompts, ferramentas, logs e chamadas ao modelo.

## Avalon

Inicialmente será apenas a camada de execução manual. O sistema não deve assumir acesso ao feed ou à execução da Traderoom sem integração comprovada.

## Conhecimento do Wil Trader

O projeto pode incorporar conceitos e métodos encontrados no material do Wil Trader, mas eles serão tratados como hipóteses a serem testadas. Nenhuma técnica será considerada válida apenas por autoridade ou exemplo isolado.

O conhecimento será organizado em uma base versionada de conceitos, setups, condições de entrada, invalidações, erros e exemplos.

## Roadmap

### Fase 1 — Fundação
- [ ] Estrutura do projeto
- [ ] Backend seguro
- [ ] Configuração da OpenAI API
- [ ] Modelo de dados
- [ ] Logs

### Fase 2 — Cérebro
- [ ] Data Guard
- [ ] Technical Engine
- [ ] Market Regime
- [ ] Setup Classifier
- [ ] Risk Engine
- [ ] No-Trade Engine
- [ ] Decision Engine

### Fase 3 — Dados
- [ ] Feed de mercado confiável
- [ ] Histórico OHLC
- [ ] Calendário macro
- [ ] Normalização dos dados

### Fase 4 — Aprendizado
- [ ] Registro de operações
- [ ] Error Bank
- [ ] Estatísticas
- [ ] Backtest
- [ ] Walk-forward
- [ ] Experiment Lab

### Fase 5 — Dashboard
- [ ] Radar de ativos
- [ ] Melhor oportunidade
- [ ] Direção
- [ ] Score
- [ ] Horário do clique
- [ ] Justificativa
- [ ] Histórico
- [ ] Assertividade

### Fase 6 — Validação
- [ ] Paper trading
- [ ] Testes de estabilidade
- [ ] Testes de falha
- [ ] Circuit breaker
- [ ] Critérios de liberação

## Regra de ouro

> **Se o sistema não sabe, ele não inventa. Ele aguarda.**