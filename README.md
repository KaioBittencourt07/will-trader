# WILL TRADER

Painel de análise assistida para operações manuais em modo DEMO/PAPER.

## Regras de segurança

- Não envia ordens para corretoras.
- Bloqueia sinais sem vantagem sobre o ponto de equilíbrio do payout.
- Usa circuit breaker após três perdas consecutivas e limite diário configurável.
- Dados da Avalon só podem ser conectados por meio oficial e autorizado.

## Estrutura

- `dashboard/`: painel estático e simulador de leituras.
- `core/signal-engine.js`: decisão COMPRA, VENDA ou AGUARDAR.
- `core/risk-engine.js`: filtros e travas de risco.
