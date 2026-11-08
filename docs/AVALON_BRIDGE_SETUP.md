# Avalon read-only bridge

## Purpose and safety boundary

The bridge forwards only sanitized market events from an Avalon Traderoom session that the user is authorized to access. It does not log in, automate clicks, send WebSocket messages, read cookies, passwords or authorization headers, or access any other device/account.

Only these event types are accepted:
- timeSync
- candle-generated

The parser stores provider time fields as raw values with timestampUnit=UNVERIFIED. The feed is SHADOW_ONLY: it does not alter BUY/SELL/WAIT decisions and cannot place orders.

## Local setup

1. In backend/.env, set a long random value for WILL_AVALON_RELAY_TOKEN. Do not commit .env and do not send this token in chat.
2. Start the backend locally from the backend directory with npm start. The default local URL is http://127.0.0.1:3000.
3. Open the Avalon Traderoom and authenticate normally.
4. In the browser DevTools Console, paste the contents of tools/avalon-bridge.js from this branch.
5. When prompted, enter the backend base URL and the same local relay token.
6. Reload the Traderoom after installing the bridge. The bridge intercepts only new WebSocket connections to ws03.ws.prod.sc-ams-1a.quadcode.tech.
7. Check window.__WILL_AVALON_BRIDGE__.stats(). matchingSockets should be greater than zero and sent should increase as events arrive.
8. Open the WILL dashboard. The Avalon (shadow) status shows the active_id values received.

For a remote backend, use HTTPS. The server permits the Avalon origin only for the POST /api/avalon/ingest route and requires the shared relay token. The browser may ask permission for local-network access when the backend is on localhost.

## Stop the bridge

Run window.__WILL_AVALON_BRIDGE__.stop() in the same console, then reload the Traderoom.

## Before promoting Avalon data into the strategy

Do not use the feed for decisions until all of the following are verified with observed evidence:
- the mapping from each active_id to its exact market symbol;
- the units and timezone semantics of at, from, to and timeSync;
- whether phase identifies an open or closed candle;
- consistency of bid/ask and OHLC against an independent market source;
- freshness and reconnect behavior over a sustained session.

The current parser intentionally does not infer these facts. A received active_id is not yet an approved asset mapping.
