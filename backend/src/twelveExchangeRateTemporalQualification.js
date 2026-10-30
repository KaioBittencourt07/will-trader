import { qualifyTemporalAuthorityObservation } from './temporalAuthorityProvider.js';

export const TWELVE_EXCHANGE_RATE_TEMPORAL_VERSION = 'twelve-exchange-rate-temporal-v1';
export const TWELVE_EXCHANGE_RATE_MAX_SKEW_MS = 5_000;
export const TWELVE_EXCHANGE_RATE_MIN_OBSERVATIONS = 4;

const canonical = (value) => String(value || '').trim().toUpperCase();
const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value));

export function observationFromTwelveExchangeRate({ payload, receivedAt } = {}) {
  const symbol = canonical(payload?.symbol);
  const rate = finite(payload?.rate) ? Number(payload.rate) : null;
  const rawTimestamp = finite(payload?.timestamp) ? Number(payload.timestamp) : null;
  const eventTimestamp = rawTimestamp === null ? null : (rawTimestamp < 10_000_000_000 ? rawTimestamp * 1_000 : rawTimestamp);
  if (!symbol) throw new Error('TWELVE_EXCHANGE_RATE_SYMBOL_MISSING');
  if (rate === null || rate <= 0) throw new Error('TWELVE_EXCHANGE_RATE_RATE_INVALID');
  if (eventTimestamp === null) throw new Error('TWELVE_EXCHANGE_RATE_TIMESTAMP_MISSING');
  if (!Number.isFinite(Date.parse(receivedAt ?? ''))) throw new Error('TWELVE_EXCHANGE_RATE_RECEIVED_AT_MISSING');
  return Object.freeze({
    provider: 'twelvedata-exchange-rate',
    source: 'twelvedata-exchange-rate',
    symbol,
    rate,
    eventTimestamp,
    receivedAt: new Date(Date.parse(receivedAt)).toISOString(),
    timestampAuthority: 'TWELVE_EXCHANGE_RATE_PROVIDER_EVENT_TIME',
    provenanceVerified: true,
    perEventSemanticsVerified: false,
    decisionImpact: 'NONE',
    ordersExecuted: 0
  });
}

export function qualifyTwelveExchangeRateSeries({ observations = [], now = Date.now(), maxSkewMs = TWELVE_EXCHANGE_RATE_MAX_SKEW_MS } = {}) {
  const valid = observations
    .filter((item) => item && finite(item.eventTimestamp) && finite(item.rate) && Number.isFinite(Date.parse(item.receivedAt ?? '')))
    .map((item) => ({ ...item, eventTimestamp: Number(item.eventTimestamp), rate: Number(item.rate), receivedAtMs: Date.parse(item.receivedAt) }));

  let timestampRegressions = 0;
  let repeatedTimestampRateChanges = 0;
  let progressions = 0;
  let maxAbsEventReceiveSkewMs = 0;
  const distinct = new Set();

  for (let i = 0; i < valid.length; i += 1) {
    const current = valid[i];
    distinct.add(current.eventTimestamp);
    maxAbsEventReceiveSkewMs = Math.max(maxAbsEventReceiveSkewMs, Math.abs(current.receivedAtMs - current.eventTimestamp));
    if (i === 0) continue;
    const previous = valid[i - 1];
    if (current.eventTimestamp < previous.eventTimestamp) timestampRegressions += 1;
    if (current.eventTimestamp > previous.eventTimestamp) progressions += 1;
    if (current.eventTimestamp === previous.eventTimestamp && current.rate !== previous.rate) repeatedTimestampRateChanges += 1;
  }

  const enoughObservations = valid.length >= TWELVE_EXCHANGE_RATE_MIN_OBSERVATIONS;
  const timestampProgresses = progressions > 0 && distinct.size >= 2;
  const receiveClockCoherent = valid.length > 0 && maxAbsEventReceiveSkewMs <= maxSkewMs;
  const coarseTimestampObserved = repeatedTimestampRateChanges > 0;
  const perEventSemanticsVerified = enoughObservations
    && timestampProgresses
    && timestampRegressions === 0
    && repeatedTimestampRateChanges === 0
    && receiveClockCoherent;

  const latest = valid.at(-1) ?? null;
  const authority = latest ? qualifyTemporalAuthorityObservation({
    provider: 'twelvedata-exchange-rate',
    symbol: latest.symbol,
    eventTimestamp: latest.eventTimestamp,
    receivedAt: new Date(latest.receivedAtMs).toISOString(),
    timestampAuthority: 'TWELVE_EXCHANGE_RATE_PROVIDER_EVENT_TIME',
    provenanceVerified: true,
    perEventSemanticsVerified,
    now
  }) : null;

  const semanticReasonCodes = [
    'OFFICIAL_DOCS_EXCHANGE_RATE_RETURNS_UNIX_TIMESTAMP_OF_RATE',
    ...(enoughObservations ? [] : ['EXCHANGE_RATE_OBSERVATIONS_INSUFFICIENT']),
    ...(timestampProgresses ? [] : ['EXCHANGE_RATE_TIMESTAMP_DID_NOT_PROGRESS']),
    ...(timestampRegressions ? ['EXCHANGE_RATE_TIMESTAMP_REGRESSION'] : []),
    ...(repeatedTimestampRateChanges ? ['EXCHANGE_RATE_RATE_CHANGES_SHARE_TIMESTAMP'] : []),
    ...(receiveClockCoherent ? [] : ['EXCHANGE_RATE_EVENT_RECEIVE_SKEW_TOO_LARGE'])
  ];

  return Object.freeze({
    version: TWELVE_EXCHANGE_RATE_TEMPORAL_VERSION,
    source: 'TWELVE_OFFICIAL_EXCHANGE_RATE_DOCUMENTATION_PLUS_RUNTIME_OBSERVATION',
    endpoint: '/exchange_rate',
    symbol: latest?.symbol ?? null,
    timestampField: 'timestamp',
    semanticClassification: perEventSemanticsVerified
      ? 'PROVIDER_PER_EVENT_UNIX_TIMESTAMP_OBSERVED'
      : coarseTimestampObserved
        ? 'PROVIDER_COARSE_OR_BUCKETED_UNIX_TIMESTAMP_OBSERVED'
        : 'PROVIDER_EVENT_TIME_SEMANTICS_UNVERIFIED',
    semanticReasonCodes: Object.freeze(semanticReasonCodes),
    fieldProvenanceVerified: true,
    provenanceVerified: perEventSemanticsVerified,
    perEventFreshnessSemanticsVerified: perEventSemanticsVerified,
    comparableToReceiveClock: perEventSemanticsVerified,
    canEvaluateFrozenFreshness: perEventSemanticsVerified,
    observation: Object.freeze({
      acceptedObservations: valid.length,
      distinctEventTimestamps: distinct.size,
      timestampProgressions: progressions,
      repeatedTimestampRateChanges,
      timestampRegressions,
      maxAbsEventReceiveSkewMs,
      maximumAllowedEventReceiveSkewMs: maxSkewMs,
      enoughObservations,
      timestampProgresses,
      receiveClockCoherent,
      coarseTimestampObserved
    }),
    temporalAuthority: authority,
    decisionImpact: 'NONE',
    ordersExecuted: 0
  });
}
