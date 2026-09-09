# WILL — Cross-Provider Live Commissioning Readiness (13A)

## Result

`LIVE_COMPOSITION_READINESS_PREPARED` — preparation only. This result does not authorize or execute 13B, live/sim access, or prospective PAPER.

The versioned harness `cross-provider-live-commissioning-readiness-prep-v1` is pure and contains no HTTP/WebSocket client. The command `npm run commission:cross-provider-readiness` only evaluates local environment shape and prints a sanitized readiness report. With default configuration it stops as `BLOCKED_READINESS_PREP` before any external access.

## Activation guards and frozen configuration

Future readiness requires both exact flags `WILL_CROSS_PROVIDER_COMMISSIONING_ENABLED=true` and `WILL_CROSS_PROVIDER_AUTHORIZATION=13B_EXPLICITLY_AUTHORIZED`. Saxo environment must be explicitly `sim` or `live`; credentials are presence-tested only from runtime environment and never returned. Frozen mapping is EUR/USD, UIC 21, FxSpot, Horizon 1 / 1min. Entitlement for Saxo and Twelve remains `UNVERIFIED` regardless of configuration.

The minimum future budget is one session, one symbol, one timeframe, one subscription per provider, zero retries, at most one observable reconnect, and exactly 30,000 ms freshness. Any reset invalidates continuity and requires requalification. Phase 13A itself permits and reports zero requests/subscriptions/consumption.

## Evidence ownership

- Twelve WebSocket: quote price and provider-native event timestamp only.
- Saxo Charts: OHLC M1 and closed completeness only under `SUBSCRIPTION_INITIAL_SNAPSHOT` or `STREAM_UPDATE_CLOSED_AND_OPENED`.
- Receive/cache/local/Saxo timestamps cannot replace Twelve event time.
- Twelve cannot declare candle closure; Saxo cannot declare quote freshness; OHLC is never mixed.

## Sanitized example

```json
{
  "result": "LIVE_COMPOSITION_READINESS_PREPARED",
  "valid": false,
  "decisionImpact": "NONE",
  "prospectivePaperAuthorized": false,
  "phase13bExecuted": false,
  "externalCallsPerformed": 0,
  "configuration": {
    "environment": "sim",
    "saxoTokenConfigured": true,
    "twelveKeyConfigured": true,
    "secretsExposed": false
  },
  "entitlement": { "saxo": "UNVERIFIED", "twelve": "UNVERIFIED" },
  "counters": { "sessions": 0, "saxoRequests": 0, "twelveSubscriptions": 0, "reconnects": 0, "resets": 0 }
}
```

## External limitations and next gate

Not verified: account/app availability, Brazilian eligibility, Saxo EUR/USD M1 entitlement in SIM/live, Twelve plan entitlement, simultaneous provider timing, reconnect/reset behavior, clock skew, or operational reliability. A separately authorized 13B would need explicit local operator authorization and bounded real credentials; none should be supplied through chat, GitHub, source, logs, or evidence.

No account, token, app, login, external call, commissioning, batch, 20C.6 authorization, decision change, or merge occurred.

## Fase 20C.6.13B-R1 — root cause e hardening offline

- Saxo root cause confirmada: o request da subscription omitia `Arguments.FieldGroups: ["ChartInfo"]`. A API retorna bare OHLC por padrão, portanto `Snapshot.ChartInfo.Horizon` não estava disponível e o parser corretamente rejeitou a evidência. O request agora solicita `ChartInfo`, exige o wrapper oficial `Snapshot` e continua exigindo Horizon numérico exatamente 1 e completed samples do initial snapshot.
- Twelve root causes confirmadas: o runner dependia implicitamente de `globalThis.WebSocket` sem preflight e `reconnects` era apenas métrica, não hard cap. O padrão de quatro falhas imediatas dentro de 15 s é compatível com runtime sem WebSocket, mas o erro sanitizado anterior não permite distinguir isso de outra falha imediata de transporte. Agora ausência do runtime bloqueia antes de Saxo/rede com `TWELVE_WEBSOCKET_RUNTIME_UNAVAILABLE`; o feed impede agendamento acima de `maxReconnects`, o runner fixa 1 e limita o total a uma única subscription. `stop()` cancela o timer.
- Se o runtime existir e ainda houver falha, o relatório preserva apenas o erro redigido para atribuição futura, sem expor URL/key.
- R1 é offline: nenhuma credencial, chamada provider, commissioning ou fallback REST.

## Fase 20C.6.13B-R3 — root cause após R2

- Saxo confirmada: R1 solicitou apenas `FieldGroups:["ChartInfo"]`. A API usa FieldGroups para definir os grupos retornados; por isso Horizon passou, mas `Snapshot.Data` ficou ausente. O request agora pede explicitamente `ChartInfo` e `Data`, com `ChartSampleFieldSet:Default`. O parser distingue Data ausente (`SAXO_OHLC_DATA_MISSING`), vazio (`SAXO_OHLC_DATA_EMPTY`) e sample incompleto/malformado (`SAXO_OHLC_MALFORMED`), sempre fail-closed.
- O shape documental permanece `response.Snapshot.Data[]`, com `Time` e campos ChartSample. O transformer continua aceitando somente o conjunto OHLC direto `Open/High/Low/Close`; campos Bid/Ask não são silenciosamente convertidos em midpoint ou OHLC sintético.
- Twelve: Node oferece WebSocket browser-compatible a partir das versões documentadas, mas o evento real R2 expôs apenas `WEBSOCKET_ERROR`; portanto TLS/DNS/proxy/firewall/auth não podem ser distinguidos retroativamente. O feed agora captura, quando fornecidos pelo runtime, `code`, `cause`, fase PRE_OPEN/POST_OPEN/CONSTRUCTOR, categoria conservadora e close code, com URL/key redigidos. O hard cap permanece 1.
- R3 executou zero chamadas/provider credentials. Nova sessão deve ser autorizada separadamente e apenas para obter evidência sanitizada dos dois providers.

## Fase 20C.6.13B-R5 — root cause após R4

- Saxo root cause documental confirmada: `FxSpot` no field set Default usa samples BidAsk (`OpenBid/OpenAsk`, `HighBid/HighAsk`, `LowBid/LowAsk`, `CloseBid/CloseAsk`). O contrato atual exige um único OHLC direto e por isso rejeitou o shape como `SAXO_OHLC_MALFORMED`. R5 não escolhe bid, ask nem midpoint. Um diagnóstico estrutural registra apenas count, nomes allowlisted, presença numérica, timestamps válidos e classificação; nunca preços ou payload bruto.
- Shapes classificados: `DIRECT_OHLC` é elegível ao transformer existente; `BID_ASK_OHLC` é documental, porém incompatível com o contrato single-OHLC; missing, empty e incomplete permanecem bloqueados separadamente.
- Twelve continua sem root cause de transporte confirmável: o EventTarget WebSocket do Node pode emitir ErrorEvent genérico sem code/cause. R5 adiciona descrição local do runtime e agrega close code/reason sanitizados ao diagnóstico quando disponíveis. DNS/TLS/proxy preflight externo não foi executado porque violaria ZERO provider calls e não provaria o handshake autenticado.
- Nova sessão R6 não é recomendada até existir decisão formal sobre qual semântica BidAsk, se alguma, pode alimentar o contrato OHLC. Twelve pode ser reobservado somente dentro dessa futura autorização única.

## Fase 20C.6.13B — commissioning controlado

O harness `cross-provider-readonly-commissioning-v1` limita a execução a uma sessão EUR/USD 1min, Saxo SIM Charts e uma assinatura Twelve WS. Ele exige autorização 13B exata, possui zero retry, preserva o gate de 30.000 ms e retorna somente evidência sanitizada. Sem as duas credenciais runtime, encerra antes de rede como `BLOCKED_EXTERNAL`.

No ambiente Codex de 2026-09-09, ambas as credenciais estavam ausentes. Assim, nenhuma chamada, conexão ou assinatura foi realizada e entitlement/market data SIM permanecem externamente não verificados. O resultado desta execução é `BLOCKED_EXTERNAL`; isso não autoriza PAPER prospectivo, 20C.6 final ou ordens.
