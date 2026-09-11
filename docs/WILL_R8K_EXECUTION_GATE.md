# WILL R8K — Timestamp Semantics Execution Gate

Status: RUNNER PREPARED OFFLINE. EXPLICIT ONE-SHOT AUTHORIZATION RECEIVED. AUTHORIZATION NOT CONSUMED UNTIL `externalProviderCalls=1`.

## Purpose
R8K is a bounded evidence gate intended to investigate the semantics of the Twelve Data WebSocket `timestamp` field without changing the frozen freshness contract or granting trading authority.

Public Twelve Data documentation describes WebSocket `price` events as real-time tick prices and says the message includes a UNIX timestamp, but that wording alone is not treated by WILL as proof that the field is an independent per-tick event-time suitable for the 30,000 ms freshness contract.

## Frozen scope
- symbol: EUR/USD only
- one WebSocket connection
- one subscribe attempt
- 60 second observation window
- 5 second pre-accept timeout
- heartbeat >= 10 seconds
- zero retries, reconnects, redirects, REST calls or Avalon calls
- metadata-only output
- no raw payload retention
- no raw price retention
- no raw timestamp retention
- freshness contract remains exactly 30,000 ms
- providerCommissioning=false
- decisionImpact=NONE
- prospectivePaperAuthorized=false
- ordersExecuted=0

## Runtime gate
External execution requires all three local runtime inputs:
- `WILL_TWELVE_R8K_ENABLED=true`
- `WILL_TWELVE_R8K_AUTHORIZATION=R8K_TIMESTAMP_SEMANTICS_EXPLICITLY_AUTHORIZED`
- local `TWELVEDATA_API_KEY`

Historical R8I/R8J authorization does not authorize R8K.

The prepared entrypoint is:
- `npm run observe:twelve-r8k`

The entrypoint is wired to the metadata-only observer. The observer retains only aggregate counts/flags needed for semantic review and explicitly reports `rawPayloadRetained=false`, `rawPriceRetained=false`, and `rawTimestampRetained=false`.

## Authorization consumption rule
The current explicit one-shot authorization is consumed only when an external provider call actually occurs and the resulting bounded observation reports `externalProviderCalls=1`. A blocked local gate, missing key, or pre-network validation failure does not consume the authorization.

After one external call occurs, R8K must not be rerun without a new explicit authorization.

## Evidence rule
Even a successful bounded observation returns `UNVERIFIED_PENDING_EVIDENCE_REVIEW`. Aggregate metadata does not automatically prove provider semantics. Promotion of timestamp semantics requires a separate evidence review and durable decision.

## Safety
R8K cannot commission Twelve Data, authorize PAPER, alter strategy/thresholds, place an order, or reinterpret arrival time as market event time.
