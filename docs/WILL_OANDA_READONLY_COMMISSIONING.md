# OANDA Read-Only One-Shot Commissioning

Status after Phase 20C.6.8 Part A: `LIVE_READY_FOR_LOCAL_COMMISSIONING`. Adapter `oanda-rest-v20-readonly-adapter-v1` is OFF by default and has not been called live by Codex.

The command `npm run commission:oanda-readonly` in `backend` performs one bounded read-only attempt with exactly two GET requests: account pricing for `EUR_USD`, and instrument candles with `price=M`, `granularity=M1`, `count=50`. It contains no loop, order/trade/position mutation endpoint or quota polling. The shared engine runs with zero retries and opens the existing cooldown on 429.

Local prerequisites, only after the user confirms API eligibility:

- `WILL_OANDA_ENABLED=true`
- `OANDA_ENVIRONMENT=practice` (or explicitly authorized `live`)
- `OANDA_TOKEN` in the local secret environment
- `OANDA_ACCOUNT_ID` in the local secret environment

The report exposes only configured booleans, environment, sanitized HTTP state, canonical/provider mapping, quote/candle timestamps and ages, completeness, OHLC adequacy, freshness/provenance, request count/latency, readiness/cooldown and result. It never reports token or account ID values. Any missing/invalid configuration, 401/403, 429, 5xx/network/timeout, stale quote, incomplete/malformed candle or mismatch stops the one-shot attempt fail-closed.

Do not run the command repeatedly, commit `.env`, paste credentials into chat, query quota, or start a prospective batch. Live execution is Part B and must occur locally under the explicit external gate in the authorization.
