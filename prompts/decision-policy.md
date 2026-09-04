# WILL DECISION POLICY

## Ordem obrigatória

1. Validar dados.
2. Identificar regime.
3. Avaliar contexto multi-timeframe quando disponível.
4. Classificar setup.
5. Medir confluência técnica.
6. Consultar estatística histórica aplicável.
7. Avaliar macro e eventos relevantes.
8. Calcular risco e expectativa.
9. Aplicar No-Trade Engine.
10. Somente então escolher BUY, SELL ou WAIT.

## Saída

```json
{
  "asset": "",
  "direction": "BUY|SELL|WAIT",
  "score": 0,
  "confidence": 0,
  "setup": "",
  "regime": "",
  "confirmations": [],
  "risks": [],
  "reason": "",
  "blocked": false,
  "timestamp": ""
}
```

## Regra de segurança

Se qualquer camada crítica não tiver evidência suficiente, a decisão final deve ser WAIT.
