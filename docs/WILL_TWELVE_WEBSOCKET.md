# WILL Twelve WebSocket Foundation — 20C.8

## Escopo

O feed Twelve Data WebSocket é uma fonte central de ticks exclusivamente em modo
`SHADOW_OBSERVABILITY`. Ele não substitui candles REST, não constrói OHLC, não
alimenta o Champion e não participa de BUY/SELL/WAIT.

O recurso permanece desativado por padrão. Para uma observação autorizada futura,
é necessário definir `WILL_TWELVE_WS_ENABLED=true`, `TWELVEDATA_API_KEY` e a lista
controlada `WILL_TWELVE_WS_SYMBOLS`.

## Contrato operacional

- uma única conexão por processo;
- subscrição consolidada dos símbolos configurados;
- heartbeat a cada 10 segundos;
- reconexão com backoff exponencial limitado;
- deduplicação por símbolo, timestamp de evento e preço;
- timestamps de evento e recepção, detecção de stale e gaps;
- shutdown em `SIGINT`/`SIGTERM`;
- nenhum segredo retornado pela telemetria ou enviado ao frontend.

`GET /api/market/status` expõe `webSocketShadow` com mensagens recebidas, símbolos
ativos, reconexões, idade do último tick, gaps, duplicatas, disponibilidade e o
potencial observacional de redução REST. `requestsAvoided` permanece sempre zero:
a fundação não muda o tráfego REST nem qualquer contrato decisório.

## Commissioning controlado

`npm run commission:ws` no diretório `backend` executa uma sessão manual limitada
de 5 a 60 segundos. A chave é lida somente de `TWELVEDATA_API_KEY`; apenas o primeiro
símbolo de `WILL_TWELVE_WS_SYMBOLS` é usado. O comando não chama REST, não consulta
quota, não inicia monitor/batch e encerra a conexão antes de imprimir telemetria
sanitizada. `APPROVED` exige conexão, aceite de subscrição e ao menos um tick real.

Além das métricas da fundação, o commissioning registra conexões bem-sucedidas,
subscrições solicitadas/aceitas/rejeitadas, primeiro/último tick, uptime, motivo de
disconnect e backoff. Créditos REST permanecem zero; créditos WS são apenas uma
estimativa não autoritativa baseada nas subscrições aceitas.

## Limites explícitos

Não há inferência de candle ausente, agregação OHLC, substituição silenciosa de
provider, batch prospectivo, execução real ou mudança em estratégia, thresholds,
timing, freshness decisório, scanner ou ranking.
