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

## Fase 20C.6.13B-R5S — decisão semântica Bid/Ask offline

- Contrato `bid-ask-ohlc-v1`: bid e ask preservam OHLC independentes, timestamp e evidência de fechamento. Não existe midpoint nem lado selecionado.
- `providerEvidenceValid:true` não implica compatibilidade: Saxo BidAsk documental é `marketDataRepresentation:BID_ASK_OHLC` e `championCompatible:false`.
- Cada lado valida numericidade e range internamente. Não há hard gate cross-side `ask >= bid`, pois a documentação consultada descreve campos, mas não estabelece esse invariante como contrato universal por sample.
- Com Twelve quote fresh independente, a composição pode ser `PROVIDER_EVIDENCE_COMPOSABLE_OFFLINE`, sempre `valid:false`, `decisionImpact:NONE` e sem consumidor Champion/PAPER.
- Single-OHLC permanece separado e backward compatible. R5S fez zero chamadas e não autoriza R6.

## Fase 20C.6.13B-R6-PREFLIGHT — auditoria offline do gate

- O gate de commissioning agora exige conjuntamente a versão single-OHLC, `COMPOSABLE_OFFLINE`, `DIRECT_OHLC_PLUS_INDEPENDENT_QUOTE`, `championCompatible:true` e ausência de bypass. A igualdade do estado, isoladamente, não concede passagem.
- Saxo BidAsk válido mais quote Twelve fresca permanece `PROVIDER_EVIDENCE_COMPOSABLE_OFFLINE`, `championCompatible:false`, `valid:false`, `decisionImpact:NONE`, sem midpoint/side selection, e termina em `BLOCKED_EXTERNAL` com `CHAMPION_INCOMPATIBLE_BID_ASK`.
- O runner exige exatamente uma conexão, uma solicitação e uma aceitação de subscription; reconnect continua no máximo 1, freshness em 30.000 ms e o feed declara zero consumo REST.
- A prova é inteiramente sintética/offline. Nenhuma R6, provider call, credencial, PAPER, decisão, ordem ou merge foi autorizada.

## Fase 20C.6.13B-R7-PREP — Twelve transport root cause

- Runtime observado: Node `24.20.0`, WebSocket global browser-compatible/EventTarget, Undici `7.29.0`. O `ErrorEvent` pré-open não oferece `code`/`cause` públicos neste runtime; o `CloseEvent` oferece `code`, `reason` e `wasClean`. O close `1006` significa fechamento anormal, mas sozinho não discrimina DNS, TCP, TLS, proxy, autenticação ou rejeição do upgrade.
- `diagnostics_channel` é API oficial estável, porém os canais oficiais documentados não fornecem um diagnóstico WebSocket/Undici específico que atribua este erro. O canal `net.client.socket` é experimental e expõe o socket, não uma causa estável do upgrade WebSocket; por isso não foi acoplado ao runner.
- O protocolo implementado confere com a documentação Twelve atual: `wss://ws.twelvedata.com/v1/quotes/price?apikey=...` e subscribe JSON `{action:"subscribe",params:{symbols:"EUR/USD"}}`. A chave continua somente no runtime de commissioning e não foi usada no preflight.
- Uma medição `TRANSPORT_PREFLIGHT` não autenticada fez: uma resolução DNS; para IPv4 e IPv6, uma conexão TCP 443 nua e uma conexão TLS 443 separada com SNI/validação de certificado. Não enviou HTTP, WebSocket upgrade, API key, subscribe ou payload de aplicação.
- Resultado local: DNS IPv4+IPv6 resolvido; TCP alcançável em ambas; TLS handshake autorizado em ambas; TLS 1.3; nenhum proxy detectado nas variáveis de ambiente examinadas. Endereços resolvidos não são emitidos. Classificação: `TRANSPORT_BASIC_HEALTHY`.
- Conclusão **B**: transporte básico saudável; a falha R6 permanece provável no upgrade WebSocket, autenticação/entitlement ou comportamento do provider. O preflight não distingue essas hipóteses e não é commissioning.
- Referências oficiais: https://twelvedata.com/docs/websocket/ws-overview, https://support.twelvedata.com/en/articles/5620516-how-to-stream-the-data, https://nodejs.org/api/globals.html#class-websocket e https://nodejs.org/api/diagnostics_channel.html.

## Fase 20C.6.13B-R8-PREP — Twelve WebSocket handshake offline

- Harness HTTP/upgrade exclusivamente local observou o WebSocket global do Node 24.20.0 serializar o request target `/v1/quotes/price?apikey=<placeholder>`, HTTP Upgrade/Connection corretos, `Sec-WebSocket-Version:13`, key RFC 6455 de 16 bytes, `permessage-deflate`, `User-Agent: node` e nenhum Origin/Authorization header. O relatório retém somente presença/validade e nunca key, query value ou headers brutos.
- O runtime browser-compatible começa o handshake no construtor e o feed envia subscribe somente após `open`. Em fixtures locais, rejeições 302 e 403 aparecem publicamente como ErrorEvent sem mensagem/status mais close 1006; redirect não foi seguido. Assim, o status real não pode ser inferido de 1006.
- Classificação conservadora adicionada: status observável !=101 → `UPGRADE_HTTP_REJECTED`; 3xx/redirect observável → `REDIRECT_REJECTED`; timeout observável → `PRE_OPEN_TIMEOUT`; 1006 sem evidência adicional → `PRE_OPEN_ABNORMAL_CLOSE`, `causeConfirmed:false`, `authOrEntitlement:UNVERIFIED`.
- Undici documenta canais `undici:websocket:close` e `undici:websocket:socket_error`. No harness, close foi publicado, mas uma rejeição HTTP sintética não publicou socket_error nem expôs status. O canal de socket error não carrega identidade do WebSocket, portanto acoplá-lo ao runner multi-instância poderia atribuir erro à sessão errada; não foi adotado.
- O WebSocket global não oferece configuração explícita de ProxyAgent/family no contrato browser-compatible. O pacote Undici oferece dispatcher/ProxyAgent, mas não está instalado como dependência direta e trocar implementação/proxy seria mudança operacional fora desta fase. R7-PREP já provou ambos IPv4/IPv6 saudáveis e nenhum env proxy detectado.
- Twelve confirma autenticação por `apikey` na query, subscribe após conexão e payload action/params/symbols. O FAQ atual informa WebSocket completo no Pro, teste limitado em planos inferiores/trial symbols, até 3 conexões e créditos WS separados; o runner mantém limites internos mais estritos de 1 conexão/subscription.
- Conclusão **B**: handshake local/protocolo compatível; blocker provável em auth/entitlement/rejeição de upgrade/provider, sem causa confirmada. Nenhuma conexão ao provider, credencial ou R8 foi usada.
- Referências: https://github.com/nodejs/undici/blob/main/docs/docs/api/WebSocket.md, https://github.com/nodejs/undici/blob/main/docs/docs/api/DiagnosticsChannel.md, https://twelvedata.com/docs/websocket/ws-overview, https://support.twelvedata.com/en/articles/5620516-how-to-stream-the-data e https://support.twelvedata.com/en/articles/5194610-websocket-faq.

## Fase 20C.6.13B-R8A-PREP — diagnosticador HTTP Upgrade offline

- `twelve-handshake-diagnostic-v1` é um cliente RFC 6455 mínimo separado do feed, commissioning, composição e Champion. Ele faz no máximo um GET Upgrade, não segue redirects, não repete, nunca envia frame/subscription e encerra imediatamente após observar a resposta.
- O alvo externo exato fica fail-closed sem uma autorização futura específica; nesta fase somente localhost com flag sintética foi permitido. Nenhuma credencial real ou host provider foi usado.
- O relatório contém apenas status HTTP, classificação, presença/validade do `Sec-WebSocket-Accept`, presença de Location/Retry-After e contadores fixos. API key, WebSocket key, Location, headers, IP, body e payload bruto nunca são retornados.
- Servidores locais provaram: 101 com accept válido → `HANDSHAKE_OBSERVED`; 101 inválido → bloqueado; 302 → `REDIRECT_REJECTED`; 401/403 → `AUTH_OR_ENTITLEMENT_REJECTED`; 429 → `RATE_LIMITED`; timeout → `PRE_OPEN_TIMEOUT`. Todos com attempts=1, retries=0, redirects=false, subscribe=false e zero bytes de aplicação.
- O diagnosticador não substitui o WebSocket principal e não altera Champion, PAPER, dashboard, thresholds, Saxo, BidAsk, freshness ou budgets. R8A externa não foi autorizada.

## Fase 20C.6.13B-R8B-PREP — fluxo pós-101 offline

- `twelve-post-101-diagnostic-v1` é separado do feed, handshake-only diagnostic, commissioning, Saxo, composição, Champion e PAPER. O alvo provider permanece bloqueado sem autorização futura literal; somente localhost e placeholder sintético foram usados.
- Após OPEN/101, envia exatamente uma mensagem `{action:"subscribe",params:{symbols:"EUR/USD"}}`; zero reconnect/retry/redirect/REST e nenhum segundo subscribe. O relatório nunca inclui URL/query, key, headers, frame/payload, preço, IP, token ou texto livre do provider.
- Harness RFC 6455 local validou em ordem: subscribe accepted + quote; subscribe rejected; rejeição explícita de auth/entitlement na aplicação; payload desconhecido; silêncio pós-upgrade; close antes de status; e accepted sem quote. Quote antes de subscribe accepted falha como protocolo não reconhecido.
- Classificações são exclusivamente baseadas em evidência: sucesso completo, `SUBSCRIBE_REJECTED`, `APPLICATION_AUTH_OR_ENTITLEMENT_REJECTED`, `POST_UPGRADE_TIMEOUT`, `SUBSCRIBE_ACCEPTED_QUOTE_TIMEOUT`, `POST_UPGRADE_ABNORMAL_CLOSE`, `APPLICATION_PROTOCOL_UNRECOGNIZED` ou `POST_UPGRADE_INCONCLUSIVE`. Close/silêncio nunca inferem auth/entitlement.
- Conclusão **A**: fluxo local/protocolo pós-101 validado e pronto tecnicamente para uma futura execução diagnóstica isolada, somente após auditoria/autorização separadas. Nenhuma R8B externa foi executada ou autorizada.

## Fase 20C.6.13B-R8C-PREP — observação prolongada offline

- `twelve-post-subscribe-observation-v1` permanece isolado e aceita uma janela configurável estritamente limitada a 60 segundos. O provider fica bloqueado sem autorização futura literal; nesta fase o harness RFC 6455 usou somente localhost e segredo sintético.
- Uma conexão envia exatamente um subscribe EUR/USD. Quote imediata e tardia são observadas; silêncio e close após aceite ficam sem causa inferida; heartbeat, controle, JSON inválido e eventos desconhecidos são somente contados e não impedem uma quote posterior.
- O relatório contém apenas contadores, tempos relativos, estados booleanos, close code e classificação. Não inclui key, URL/query, headers, frames, payload, preço, IP, token, texto livre ou Location.
- Nenhuma R8C externa está autorizada. Zero provider calls, REST, Saxo, commissioning, Champion, PAPER, dashboard ou merge.
- Correção de auditoria: o timeout pré-aceite é separado e fail-closed; a janela de quote inicia somente após o `subscribe-status` aceitar explicitamente EUR/USD. `elapsedMsToFirstQuote` é relativo a esse aceite, portanto atraso de handshake/status não consome a janela pós-aceite.

## Fase 20C.6.13B-R8D-PREP — diagnóstico heartbeat-aware offline

- R8C foi consumida com handshake e subscribe aceitos, mas nenhuma price em 60s; a causa permanece não confirmada.
- `twelve-heartbeat-observation-v1` é isolado e envia `{action:"heartbeat"}` somente após aceite explícito de EUR/USD. Default 10s; qualquer uso externo futuro rejeita intervalo menor que 10s e limita a janela pós-aceite a 60s.
- Harness sintético local prova quote antes do primeiro heartbeat, quote após heartbeats, silêncio, close, tráfego control/unknown antes da quote, timeout pré-aceite e cancelamento definitivo dos timers. Heartbeat é apenas variável protocolar e nenhuma causalidade é inferida.
- Uma conexão, um subscribe, zero retry/reconnect/redirect/REST/Saxo. Saída allowlisted sem segredo, URL/query, header, frame, payload, preço, IP, token, texto livre ou Location.
- R8D externa NÃO está autorizada; zero provider calls, credenciais reais, commissioning, Champion, PAPER, dashboard, ordens ou merge.

## Fase 20C.6.13B-R8E-PREP — gate offline de readiness Twelve WS

- R8D foi consumida e observou quote 477ms após aceite, antes do primeiro heartbeat; isso prova entrega possível, não causalidade de heartbeat nem confiabilidade contínua. O silêncio R8C permanece sem causa confirmada.
- `twelve-ws-provider-readiness-v1` é função pura, sem capacidade de rede, que aceita apenas evidência sanitizada R8B/R8C/R8D, normaliza variantes, deduplica registros idênticos e rejeita campos raw/secretos ou invariantes operacionais alterados.
- O fixture congelado R8C sem quote + R8D com quote resulta em `INTERMITTENT_BEHAVIOR_OBSERVED`, `providerCommissioning:false`, `decisionImpact:NONE`, PAPER falso e zero ordens. Nenhuma estabilidade, causa, plano, mercado, heartbeat ou rentabilidade é inferida.
- R8E externa não está autorizada; zero provider, credencial, REST, Saxo, commissioning, Champion, PAPER, dashboard, ordem ou merge.
- Ajuste de auditoria: após deduplicação, `latestEvidenceClassification` e `latestQuoteObserved` preservam a última evidência na ordem de entrada; ordenação canônica não é usada para afirmar recência.

## Fase 20C.6.13B-R8F-PREP — observador contínuo offline

- `twelve-ws-stability-observation-v1` observa toda a janela pós-aceite (<=60s) sem parar na primeira quote. Agrega contagem, primeiro/último tempo relativo, maior gap de chegada, quantidade distinta de timestamps e eventos fora de ordem, sem expor timestamps ou preços.
- Timeout pré-aceite tem default/máximo 5s. Heartbeat só inicia após aceite, com intervalo mínimo 10s. Uma conexão/subscribe, zero retry/reconnect/redirect/REST/Saxo; timers são cancelados definitivamente no STOP.
- Classificações distinguem zero, uma e múltiplas quotes, close, pre-accept timeout, auth explícita e protocolo inconclusivo. Gap é medido, mas nenhuma regra de freshness/estabilidade ou causalidade de heartbeat é fabricada.
- R8F externa NÃO está autorizada; zero provider/credencial/commissioning/Champion/PAPER/dashboard/ordem/merge.

## Fase 20C.6.13B-R8G-PREP — pré-registro offline de commissioning

- R8F one-shot foi consumida: houve 30 chegadas na janela única, mas continuidade longitudinal, confiabilidade e freshness operacional não foram estabelecidas. Os valores R8F são fixtures históricos e não definem thresholds.
- `twelve-ws-commissioning-readiness-v1` é puro/network-free e separa dez gates. Reutiliza somente o contrato congelado de quote freshness `maxAgeMs=30000`; gap, múltiplas chegadas e diversidade de timestamp permanecem descritivos por ausência de cutoff prévio.
- O fixture R8C+R8D+R8F retorna `REQUIRES_PROSPECTIVE_VALIDATION`: uma janela positiva não satisfaz evidência longitudinal independente. Nenhum score/probabilidade, causalidade de heartbeat, estabilidade ou rentabilidade é inferido.
- Provider continua não comissionado e PAPER não autorizado; zero provider call, R8G externa, dashboard, Champion, ordem ou merge.
- Correção de auditoria: `observationWindowMs-lastQuoteElapsedMs` descreve apenas recência local de chegada e agora aparece somente como `arrivalTailObservationGate:DESCRIPTIVE_ONLY`. Não é idade do evento provider. Sem medida sanitizada de timestamp nativo versus receive/decision time, `freshnessCompatibilityGate` permanece `UNVERIFIED`; o contrato de 30s não é declarado satisfeito.

## Fase 20C.6.13B — commissioning controlado

O harness `cross-provider-readonly-commissioning-v1` limita a execução a uma sessão EUR/USD 1min, Saxo SIM Charts e uma assinatura Twelve WS. Ele exige autorização 13B exata, possui zero retry, preserva o gate de 30.000 ms e retorna somente evidência sanitizada. Sem as duas credenciais runtime, encerra antes de rede como `BLOCKED_EXTERNAL`.

No ambiente Codex de 2026-09-09, ambas as credenciais estavam ausentes. Assim, nenhuma chamada, conexão ou assinatura foi realizada e entitlement/market data SIM permanecem externamente não verificados. O resultado desta execução é `BLOCKED_EXTERNAL`; isso não autoriza PAPER prospectivo, 20C.6 final ou ordens.
