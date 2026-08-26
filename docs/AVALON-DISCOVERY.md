# Avalon Traderoom Discovery

Objetivo: identificar, de forma passiva e segura, quais fontes de dados a Traderoom entrega ao navegador.

## O que o discovery procura

- WebSocket
- HTTP fetch
- XMLHttpRequest
- recursos carregados pela página
- mensagens que aparentem conter preço, candle, ativo, timestamp ou payout

## O que NÃO faz

- não envia ordens;
- não altera mensagens;
- não tenta contornar autenticação;
- não coleta credenciais;
- não modifica a lógica da corretora.

## Procedimento

1. Entre normalmente na Traderoom com uma conta/sessão autorizada.
2. Abra DevTools com `F12`.
3. Abra `Console`.
4. Abra `tools/avalon-discovery.js` no repositório.
5. Cole o conteúdo no Console e execute.
6. Recarregue a Traderoom.
7. Troque alguns ativos e timeframes normalmente.
8. Aguarde alguns segundos para capturar mensagens.
9. No Console execute `__WILL_AVALON_EXPORT__()`.
10. O navegador baixará `will-avalon-discovery.json`.

## Próxima análise

O JSON será usado para classificar cada conexão como:

`market-data` / `chart-data` / `clock` / `payout` / `unrelated` / `unknown`.

Depois construiremos o adapter somente para dados que possam ser obtidos legitimamente e validados contra a interface.
