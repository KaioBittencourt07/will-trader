# WILL Provider Efficiency & Credit Accounting

Status: Fase 20C.7, observacional, PAPER/MANUAL. Versão do contrato: `provider-efficiency-v1`.

## O que é medido

Cada request/ciclo expõe um objeto aditivo `providerEfficiency` com:

- `externalRequests`: chamadas HTTP realmente iniciadas contra a Twelve Data (`quote` e `time_series` são contadas separadamente);
- `cacheHits` / `cacheMisses`: snapshots por chave `asset|timeframe|outputsize` atendidos ou ausentes no Market Data Engine;
- `deduplicated`: consumidores que reutilizaram uma promise in-flight para a mesma chave;
- `limiterWaitMs`: espera local atribuível à observação;
- `externalLatencyMs`: soma das latências das chamadas HTTP externas, inclusive falhas;
- `creditsEstimated`: estimativa local, nunca saldo oficial;
- `creditsEstimatedIsOfficial: false`: marcador explícito de não autoridade.

Telemetria é somente saída. Falta, erro ou objeto de telemetria inválido não participa do Data Guard nem do pipeline decisório.

## Mapa de consumo

| Fluxo | Caminho até Twelve Data | Miss saudável | Hit saudável |
| --- | --- | ---: | ---: |
| `GET /api/market` | Market Data Engine -> `getSnapshot` -> quote + time_series | 2 HTTP; ~2 créditos estimados | 0 HTTP; 0 crédito |
| `GET /api/market/diagnostic` | mesmo engine/cache e shape de 50 candles | 2 HTTP; ~2 créditos estimados | 0 HTTP; 0 crédito |
| `GET /api/opportunities` | scheduler -> `getSnapshots` batch -> quote + time_series | 2 HTTP; ~`2 * símbolos` créditos estimados | 0 HTTP para símbolos em cache |
| Scanner | não acessa o provider diretamente; consome snapshots de opportunities | já contabilizado em opportunities | já contabilizado |
| Monitor PAPER | diagnostic seguido de opportunities, ambos com 50 candles | ciclo de 1 ativo: 2 HTTP; ~2 créditos, depois 1 hit | 0 HTTP se o snapshot já estiver fresco |
| Relay local | chama `/api/market` do processo relay; a telemetria retornada é agregada no request de opportunities | conforme resposta do relay | conforme resposta do relay |
| `GET /api/market/multi` | uma chave/timeframe por chamada sequencial | até 2 HTTP por timeframe | 0 HTTP por timeframe em cache |

Hipótese de estimativa: cada endpoint Twelve Data por símbolo custa um crédito; por isso quote + time_series de um símbolo estima 2, e um batch de N símbolos estima `2N`. A cobrança real pode variar por plano/endpoint e somente `/api_usage` da Twelve Data é autoritativo. O WILL não usa a estimativa para liberar, bloquear ou ajustar decisões.

## Antes e depois

Antes da 20C.7, `upstreamRequests` representava apenas uma chamada lógica do Market Data Engine. Uma chamada lógica escondia dois requests HTTP e não atribuía cache/limiter/latência a um request ou ciclo.

Depois da 20C.7:

- um miss de um ativo é objetivamente `externalRequests=2`, `cacheMisses=1`, `creditsEstimated=2`;
- diagnostic -> opportunities para o mesmo ativo/timeframe/outputsize é `2` requests externos no ciclo inteiro, com `cacheHits=1` no segundo estágio e sem segunda espera do limiter;
- batch de N ativos continua usando dois requests HTTP, com estimativa `2N`;
- chamadas concorrentes idênticas continuam deduplicadas;
- 429 e telemetria ausente continuam fail-closed e não geram snapshot, decisão ou execução sintética.

## Invariantes

Nenhum Champion, versão de estratégia/modelo/feature/regime/timing, threshold, freshness gate, scanner, ranking, BUY/SELL/WAIT, Evidence Store ou Outcome Resolver foi alterado. Timeouts não foram aumentados. Não existe chamada a `/api_usage`, contador autoritativo, auto-click, ordem real, promoção, calibração, auto-tuning ou batch prospectivo nesta fase.
