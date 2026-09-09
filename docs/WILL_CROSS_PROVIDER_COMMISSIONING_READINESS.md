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
