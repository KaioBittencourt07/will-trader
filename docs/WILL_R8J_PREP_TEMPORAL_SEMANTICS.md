# WILL — R8J-PREP Temporal Semantics

## Scope

R8J-PREP is offline only. It does not call Twelve Data, Saxo, Avalon, REST, WebSocket, broker, PAPER, dashboard, or order execution.

The objective is to keep four temporal dimensions separate:

1. provider-native event timestamp progression;
2. receive/arrival timestamp progression;
3. quote arrival cadence;
4. the frozen 30,000 ms native-event freshness contract.

Arrival time is diagnostic only and never replaces provider-native event time for freshness.

## New diagnostic

`twelve-ws-temporal-semantics-v1` composes the existing arrival/native diagnostic and classifies only sanitized structural evidence.

`MINUTE_BUCKET_PATTERN_SUPPORTED` requires all of the following in the supplied offline samples:

- at least one positive native timestamp advance;
- every positive native advance observed is exactly 60,000 ms;
- repeated quotes share the same native timestamp;
- receive/arrival timestamps continue advancing;
- no native or arrival regression;
- no invalid sample.

When this pattern is supported, the semantic label is only:

`LIKELY_MINUTE_BUCKET_MARKER_DESCRIPTIVE_ONLY`

This is not proof of provider semantics, not commissioning, not a freshness bypass, and not authorization for PAPER.

## Safety invariants

The report always preserves:

- `freshnessContractMs: 30000`;
- `freshnessContractChanged: false`;
- `freshnessAuthority: UNCHANGED_NATIVE_EVENT_TIME_CONTRACT`;
- `arrivalTimeRole: TRANSPORT_CADENCE_DIAGNOSTIC_ONLY`;
- `providerCommissioning: false`;
- `decisionImpact: NONE`;
- `prospectivePaperAuthorized: false`;
- `ordersExecuted: 0`;
- `externalProviderCalls: 0`;
- `rawTimestampsExposed: false`.

Regression or malformed evidence fails closed descriptively.

## Relationship to R8I

The completed controlled R8I observation reported 27 quote messages, 27 valid native timestamps, 2 distinct native timestamps, 25 repeated-timestamp quotes, one native advance of 60,000 ms, zero timestamp regressions, and freshness classification `FRESHNESS_CONTRACT_FAILED` under the frozen 30,000 ms contract.

R8J-PREP does not replay the original 27 raw events because the R8I observer intentionally did not persist or expose that raw sequence. Therefore R8J-PREP uses synthetic/versioned fixtures to validate the diagnostic logic only. It must not relabel the historical R8I observation as proof of minute-bucket semantics.

## Next gate

No new provider observation is authorized by R8J-PREP. A future bounded evidence-capture gate, if separately authorized, would need to capture only sanitized per-event temporal deltas or equivalent structural evidence sufficient to test the R8J hypothesis without storing prices, credentials, or raw provider payloads.
