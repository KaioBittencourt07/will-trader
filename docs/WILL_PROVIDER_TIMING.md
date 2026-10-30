# Fase 20C.6.1 — Freshness / Provider Timing Investigation

## Resultado

`BLOCKED/EXTERNAL PROVIDER SEMANTICS` para retomar a 20C.6. O caso observado de
30,5 segundos é reproduzível e continua corretamente bloqueado pelo gate existente
de 30 segundos. O threshold não foi alterado.

Uma falha independente foi corrigida: cache hits devolviam `valid`, `status` e
`ageMs` calculados no instante do fetch. Agora snapshots com o contrato explícito
`rest-quote-freshness-v1` são reavaliados pelo relógio atual usando exclusivamente
o timestamp original da quote. `storedAt`, receive time, candle time e WS time nunca
substituem a base do gate.

## Mapa de timestamps

| Campo | Origem | Uso |
| --- | --- | --- |
| `quoteTimestamp` | `quote.last_quote_at` ou `quote.timestamp` da Twelve | Base única do gate atual |
| `timestamp` | cópia compatível de `quoteTimestamp` | Contrato legado do snapshot |
| `latestCandleTimestamp` / `candleTimestamp` | `time_series.values[0].datetime`, solicitado em UTC | Telemetria e features OHLC |
| `latestClosedCandleTimestamp` | `null` | O payload atual não prova que o primeiro candle está fechado |
| `providerReceivedAt` | relógio local depois do parse das duas respostas | Observabilidade, nunca freshness |
| `providerTiming.providerLatencyMs` | `null` | Latência provider/network não é separável honestamente só pelo payload |
| `providerEfficiency.externalLatencyMs` | duração HTTP observada localmente | Latência externa agregada |
| `cacheAgeMs` | relógio atual menos `storedAt` do engine | Idade do cache, nunca idade de mercado |
| `webSocketShadow.lastTickAgeMs` | evento/recepção do tick WS | SHADOW somente |

`quoteAgeMs = Date.now() - quoteTimestamp`. O status é `STALE` quando
`quoteAgeMs > freshnessMaxAgeMs`. Não há arredondamento, clock shifting, clamp ou
uso de outro timestamp para fazer a quote parecer nova.

`candleAgeMs` é medido separadamente. Como o payload usado não identifica
inequivocamente candle fechado versus candle corrente, a telemetria declara
`candleCompleteness: UNVERIFIED_BY_PROVIDER_PAYLOAD`; ela não ganha autoridade
nova nesta fase.

## Por que as leituras preservam a fase próxima de `:30`

O limiter do `MarketDataEngine` não alinha chamadas ao relógio civil. Após um miss,
ele define a próxima janela como início do request mais 60 segundos. O monitor roda
imediatamente no start e depois por `setInterval` de 60 segundos, também ancorado no
instante de início. Assim, um primeiro miss próximo de `:30` preserva aproximadamente
essa fase nos ciclos seguintes. Uma chamada direta a market/diagnostic no mesmo
engine também pode estabelecer a fase inicial.

Diagnostic e opportunities usam a mesma chave `asset|timeframe|50`: opportunities
reutiliza o cache e não cria uma segunda espera. O limiter separa sua espera em
`limiterWaitMs`; a latência HTTP permanece em `externalLatencyMs`. Nenhum intervalo,
timeout ou quota foi aumentado.

## Antes e depois

- Antes: cache hit podia conservar `ageMs=29s` durante até 10s e permanecer válido
  mesmo quando a quote real já tinha ultrapassado 30s.
- Depois: o mesmo hit aos 31s retorna `STALE_MARKET_DATA`, mantendo
  `freshnessBasis=REST_QUOTE_TIMESTAMP` e expondo `cacheAgeMs` separadamente.
- Antes: quote, candle, receive e cache apareciam parcialmente e sem contrato único
  de origem no diagnóstico.
- Depois: a telemetria é aditiva, nomeada e versionada; campos não mensuráveis ficam
  explicitamente `null`/`UNVERIFIED`, sem inferência.

## Evidência e limite externo

O fixture determinístico de 30,5s permanece stale. A evidência operacional anterior
registrada na autorização também mostrou múltiplas respostas reais nessa faixa.
Sem relaxar o gate ou promover WS, o provider/plano atual não demonstrou que a quote
REST satisfaz consistentemente 30s. Portanto a 20C.6 não deve ser retomada até nova
decisão explícita sobre fonte/contrato de freshness.

Nenhuma chamada externa foi necessária para esta investigação; consumo observado
nesta execução: zero REST e zero WS.
