export const TEMPORAL_AUTHORITY_PROVIDER_VERSION = 'temporal-authority-provider-v1';
export const TEMPORAL_AUTHORITY_FROZEN_MAX_AGE_MS = 30_000;

const canonical = (value) => String(value || '').trim().toUpperCase();
const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value));

export function qualifyTemporalAuthorityObservation({
  provider,
  symbol,
  eventTimestamp,
  receivedAt,
  timestampAuthority,
  provenanceVerified = false,
  perEventSemanticsVerified = false,
  now = Date.now(),
  maxAgeMs = TEMPORAL_AUTHORITY_FROZEN_MAX_AGE_MS
} = {}) {
  const reasons = [];
  if (maxAgeMs !== TEMPORAL_AUTHORITY_FROZEN_MAX_AGE_MS) reasons.push('TEMPORAL_FRESHNESS_GATE_FROZEN');
  if (!provider) reasons.push('TEMPORAL_PROVIDER_MISSING');
  if (!canonical(symbol)) reasons.push('TEMPORAL_SYMBOL_MISSING');
  if (!finite(eventTimestamp)) reasons.push('TEMPORAL_EVENT_TIME_MISSING');
  if (!Number.isFinite(Date.parse(receivedAt ?? ''))) reasons.push('TEMPORAL_RECEIVE_TIME_MISSING');
  if (!timestampAuthority || timestampAuthority === 'UNRESOLVED') reasons.push('TEMPORAL_TIMESTAMP_AUTHORITY_UNRESOLVED');
  if (provenanceVerified !== true) reasons.push('TEMPORAL_PROVENANCE_NOT_VERIFIED');
  if (perEventSemanticsVerified !== true) reasons.push('TEMPORAL_PER_EVENT_SEMANTICS_NOT_VERIFIED');

  const eventMs = finite(eventTimestamp) ? Number(eventTimestamp) : null;
  const receiveMs = Number.isFinite(Date.parse(receivedAt ?? '')) ? Date.parse(receivedAt) : null;
  const eventAgeMs = eventMs === null ? null : Number(now) - eventMs;
  const receiveAgeMs = receiveMs === null ? null : Number(now) - receiveMs;
  const clockSkewMs = eventMs === null || receiveMs === null ? null : receiveMs - eventMs;

  if (eventAgeMs !== null && eventAgeMs < -1_000) reasons.push('TEMPORAL_EVENT_TIME_IN_FUTURE');
  if (eventAgeMs !== null && eventAgeMs > TEMPORAL_AUTHORITY_FROZEN_MAX_AGE_MS) reasons.push('TEMPORAL_EVENT_STALE');
  if (receiveAgeMs !== null && receiveAgeMs < -1_000) reasons.push('TEMPORAL_RECEIVE_TIME_IN_FUTURE');

  const authorityGate = reasons.some((reason) => [
    'TEMPORAL_PROVIDER_MISSING',
    'TEMPORAL_SYMBOL_MISSING',
    'TEMPORAL_EVENT_TIME_MISSING',
    'TEMPORAL_RECEIVE_TIME_MISSING',
    'TEMPORAL_TIMESTAMP_AUTHORITY_UNRESOLVED',
    'TEMPORAL_PROVENANCE_NOT_VERIFIED',
    'TEMPORAL_PER_EVENT_SEMANTICS_NOT_VERIFIED',
    'TEMPORAL_EVENT_TIME_IN_FUTURE',
    'TEMPORAL_RECEIVE_TIME_IN_FUTURE',
    'TEMPORAL_FRESHNESS_GATE_FROZEN'
  ].includes(reason)) ? 'FAIL' : 'PASS';

  const freshnessGate = authorityGate === 'PASS'
    ? (eventAgeMs !== null && eventAgeMs <= TEMPORAL_AUTHORITY_FROZEN_MAX_AGE_MS ? 'PASS' : 'FAIL')
    : 'UNVERIFIED';

  return Object.freeze({
    version: TEMPORAL_AUTHORITY_PROVIDER_VERSION,
    provider: provider ?? null,
    source: provider ?? null,
    symbol: canonical(symbol) || null,
    timestampAuthority: authorityGate === 'PASS' ? timestampAuthority : 'UNRESOLVED',
    provenanceVerified: provenanceVerified === true,
    perEventSemanticsVerified: perEventSemanticsVerified === true,
    comparableToReceiveClock: authorityGate === 'PASS',
    authorityGate,
    freshnessGate,
    freshnessContractMs: TEMPORAL_AUTHORITY_FROZEN_MAX_AGE_MS,
    eventTimestamp: eventMs,
    receivedAt: receiveMs === null ? null : new Date(receiveMs).toISOString(),
    eventAgeMs,
    receiveAgeMs,
    clockSkewMs,
    reasons: Object.freeze([...new Set(reasons)]),
    blocker: authorityGate === 'FAIL'
      ? (reasons[0] ?? 'TEMPORAL_AUTHORITY_NOT_APPROVED')
      : freshnessGate === 'FAIL'
        ? 'TEMPORAL_EVENT_STALE'
        : null,
    decisionImpact: authorityGate === 'PASS' && freshnessGate === 'PASS' ? 'ALLOW_ANALYSIS_ONLY' : 'NONE',
    ordersExecuted: 0
  });
}

export function createTemporalAuthorityProvider({ id, observe } = {}) {
  if (!id || typeof observe !== 'function') throw new Error('TEMPORAL_AUTHORITY_PROVIDER_INVALID');
  return Object.freeze({
    id,
    version: TEMPORAL_AUTHORITY_PROVIDER_VERSION,
    async getAuthority(symbol, options = {}) {
      const observation = await observe(symbol, options);
      return qualifyTemporalAuthorityObservation({ ...observation, provider: observation?.provider ?? id, symbol: observation?.symbol ?? symbol, now: options.now ?? Date.now() });
    }
  });
}
