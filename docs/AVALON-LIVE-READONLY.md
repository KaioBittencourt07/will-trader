# Avalon Live — modo leitura

Esta etapa conecta o projeto ao feed WebSocket já observado na Traderoom, sem executar ordens.

## O que foi confirmado

O feed observado entrega eventos `candle-generated` com `active_id`, OHLC, bid/ask, timestamps e `phase`, além de `timeSync`.

## Captura no navegador

1. Abra a Traderoom Avalon já autenticada.
2. Abra DevTools (`F12`) e vá para **Console**.
3. Cole o conteúdo de `tools/avalon-capture.js` e execute.
4. Recarregue a Traderoom para que a conexão WebSocket seja criada depois do capturador.
5. No Console, execute `__WILL_AVALON__.stats()` para ver os tipos de eventos capturados.
6. Execute `__WILL_AVALON__.candles().slice(-5)` para ver os últimos candles JSON.

## Segurança

O capturador é somente leitura. Ele não envia frames, não clica em Buy/Sell e não coleta cookies, senhas ou headers de autorização.

## Próxima etapa

Integrar `core/avalon-feed.js` ao dashboard e criar uma camada de normalização/identificação de ativos. O motor de sinal existente continua separado do feed; nenhuma ordem real é habilitada nesta etapa.
