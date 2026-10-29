# WILL TRADER — roteamento de fontes de mercado

## Fontes e contratos

- **Coinbase Exchange REST público**: fonte primária de cripto spot para os pares explicitamente mapeados em USD (`BTC/USD`, `ETH/USD`, `SOL/USD`, `XRP/USD`). O adaptador consulta ticker (campo documentado `ticker.time`, evento da última negociação) e candles OHLC; só velas fechadas entram nas características técnicas. Não exige chave para os endpoints públicos. O contrato e os limites devem ser reavaliados caso a Coinbase altere a API. Documentação: https://docs.cdp.coinbase.com/exchange
- **Binance Spot Market Data**: fonte primária para os pares mapeados em USDT. O timestamp da cotação é obtido de `GET /api/v3/trades` (campo de evento `time`), não de `ticker/24hr.closeTime`. Os ativos são identificados como `BTC/USDT`, `ETH/USDT`, etc. **USDT não é renomeado nem tratado como USD**. As rotas de market-data-only são documentadas em https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md.
- **Twelve Data**: provedor configurável para Forex, ações, ETFs, índices, commodities e instrumentos não mapeados aos adaptadores públicos acima. Requer chave configurada no backend. Catálogo/planos e símbolos: https://twelvedata.com/docs.
- **Frankfurter**: taxa cambial diária de referência, sem chave. Só pode apoiar contexto/relatório; os campos `tradingEligible` e `signalEligible` permanecem `false`. Documentação: https://frankfurter.dev/.
- **Avalon**: não é considerada conectada. O projeto não possui um adaptador validado para o protocolo proprietário da Traderoom. Os dados de outras bolsas não podem ser rotulados como cotações Avalon.

## Escolha e failover

Para cripto, o WILL seleciona o provedor pela lista explícita de símbolos. Se a cotação for stale, OHLC for inválido ou o fornecedor falhar, tenta Twelve Data somente se a chave estiver realmente configurada. Uma resposta de fallback registra `providerSelection.fallback=true` e a razão. O preço de uma fonte nunca é combinado silenciosamente com candles de outra.

Para instrumentos sem adaptador público específico, o WILL usa Twelve Data. Se faltarem credenciais, se o ativo não for suportado pelo plano, se ocorrer rate limit, ou se o dado estiver stale/malformado, a operação aparece como indisponível/bloqueada; não se inventam preços.

## Universo expandido

O scanner passa a reconhecer classes separadas `FOREX`, `CRYPTO`, `CRYPTO_USDT`, `STOCKS`, `ETFS`, `INDICES` e `COMMODITIES`. Os símbolos de índices/commodities são candidatos de catálogo — a disponibilidade exata depende do mapeamento/suporte do provedor e deve ser confirmada pela resposta real; o nome no watchlist não garante cobertura.

## Verificação

Os testes do adaptador utilizam respostas sintéticas para confirmar mapeamento, timestamp, barras fechadas, freshness, limites e falhas 429. Eles não consultam provedores de rede no CI. O endpoint autenticado `GET /api/market/sources` mostra links de documentação, cobertura de mapeamento e estado observado pelo processo: `IMPLEMENTED_NOT_PROBED` antes de qualquer solicitação, `RESPONSE_OBSERVED` após uma resposta válida, ou `REQUEST_FAILED` quando a última solicitação falhou. O catálogo não faz chamadas independentes de rede; os contadores vêm de leituras solicitadas pelo scanner/API.

Nenhuma destas fontes habilita execução de corretora. O WILL permanece broker-agnostic e MANUAL/PAPER.
