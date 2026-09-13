export const TWELVE_WS_TEMPORAL_AUTHORITY_VERSION = 'twelve-ws-temporal-authority-v1';
export const FROZEN_FRESHNESS_CONTRACT_MS = 30_000;

function canonical(value) {
  return String(value || '').trim().toUpperCase();
}

function finite(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function selectedTick(wsHealth = {}, symbol) {
  const target = canonical(symbol);
  return wsHealth?.symbols?.find((entry) => canonical(entry?.symbol) === target) ?? null;
}

export function evaluateTwelveWsTemporalAuthority({
  wsHealth,
  symbol,
  now = Date.now(),
  provenanceVerified = false,
  freshnessContractMs = FROZEN_FRESHNESS_CONTRACT_MS,
  futureToleranceMs = 1_000
} = {}) {
  const reasons = [];
  const tick = selectedTick(wsHealth, symbol);
  const expectedSymbol = canonical(symbol);
  const actualSymbol = canonical(tick?.symbol);
  const eventTimestamp = finite(tick?.eventTimestamp) ? Number(tick.eventTimestamp) : null;
  const receivedAtMs = Number.isFinite(Date.parse(tick?.receivedAt ?? '')) ? Date.parse(tick.receivedAt) : null;
  const eventAgeMs = eventTimestamp === null ? null : now - eventTimestamp;
  const receiveAgeMs = receivedAtMs === null ? null : now - receivedAtMs;
  const comparableToReceiveClock = eventTimestamp !== null && receivedAtMs !== null;
  const clockSkewMs = comparableToReceiveClock ? receivedAtMs - eventTimestamp : null;

  if (!wsHealth || typeof wsHealth !== 'object') reasons.push('WS_HEALTH_MISSING');
  if (wsHealth?.mode !== 'SHADOW_OBSERVABILITY') reasons.push('WS_MODE_UNEXPECTED');
  if (wsHealth?.connected !== true) reasons.push('WS_DISCONNECTED');
  if (Number(wsHealth?.subscriptionsAccepted || 0) < 1) reasons.push('WS_SUBSCRIPTION_NOT_ACCEPTED');
  if (!tick) reasons.push('WS_TICK_MISSING');
  if (tick && actualSymbol !== expectedSymbol) reasons.push('WS_SYMBOL_MISMATCH');
  if (eventTimestamp === null) reasons.push('WS_EVENT_TIMESTAMP_INVALID');
  if (receivedAtMs === null) reasons.push('WS_RECEIVED_AT_INVALID');
  if (!provenanceVerified) reasons.push('WS_EVENT_TIME_PROVENANCE_NOT_VERIFIED');
  if (eventAgeMs !== null && eventAgeMs < -Math.abs(futureToleranceMs)) reasons.push('WS_EVENT_TIMESTAMP_FUTURE');
  if (receiveAgeMs !== null && receiveAgeMs < -Math.abs(futureToleranceMs)) reasons.push('WS_RECEIVE_TIMESTAMP_FUTURE');

  const structurallyEligible = reasons.length === 0;
  const freshnessAgeMs = eventAgeMs === null || receiveAgeMs === null
    ? null
    : Math.max(eventAgeMs, receiveAgeMs);
  const freshnessGate = structurallyEligible && freshnessAgeMs !== null
    ? (freshnessAgeMs <= freshnessContractMs ? 'PASS' : 'FAIL')
    : 'UNVERIFIED';

  if (structurallyEligible && freshnessGate === 'FAIL') reasons.push('WS_EVENT_OLDER_THAN_FROZEN_CONTRACT');

  const authorityGate = structurallyEligible ? 'PASS' : 'FAIL';
  const admitted = authorityGate === 'PASS' && freshnessGate === 'PASS';

  return Object.freeze({
    version: TWELVE_WS_TEMPORAL_AUTHORITY_VERSION,
    source: 'twelvedata-websocket',
    symbol: expectedSymbol || null,
    timestampAuthority: admitted ? 'WS_PROVIDER_EVENT_TIME' : 'UNRESOLVED',
    provenanceVerified: provenanceVerified === true,
    comparableToReceiveClock,
    authorityGate,
    freshnessGate,
    freshnessContractMs,
    eventTimestamp,
    receivedAt: receivedAtMs === null ? null : new Date(receivedAtMs).toISOString(),
    eventAgeMs,
    receiveAgeMs,
    freshnessAgeMs,
    clockSkewMs,
    blocker: admitted ? null : (reasons[0] ?? 'WS_TEMPORAL_AUTHORITY_UNRESOLVED'),
    reasons: Object.freeze([...new Set(reasons)]),
    decisionImpact: admitted ? 'ALLOW_ANALYSIS_ONLY' : 'NONE',
    ordersExecuted: 0
  });
}
