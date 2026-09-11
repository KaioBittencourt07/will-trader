export const TWELVE_WS_COMMISSIONING_READINESS_VERSION = 'twelve-ws-commissioning-readiness-v1';
export const FROZEN_QUOTE_MAX_AGE_MS = 30_000;
const COMPLETE_WINDOW_MS = 60_000;
const VERSIONS = new Set(['twelve-post-subscribe-observation-v1', 'twelve-heartbeat-observation-v1', 'twelve-ws-stability-observation-v1']);
const KEYS = new Set(['diagnosticVersion', 'connections', 'handshakeAccepted', 'subscribeSent', 'subscribeAttempts', 'subscribeAccepted',
  'firstQuoteObserved', 'quoteObserved', 'quoteMessagesObserved', 'elapsedMsToSubscribeStatus', 'elapsedMsToFirstQuote', 'firstQuoteElapsedMs',
  'lastQuoteElapsedMs', 'maxInterQuoteGapMs', 'distinctQuoteEventTimestampCount', 'outOfOrderEventCount', 'observationWindowMs',
  'preAcceptTimeoutMs', 'heartbeatsSent', 'heartbeatIntervalMs', 'nonPriceMessagesObserved', 'closeCode', 'retries', 'reconnects',
  'redirects', 'applicationMessagesSent', 'classification', 'causeConfirmed', 'providerCommissioning', 'decisionImpact',
  'prospectivePaperAuthorized', 'ordersExecuted', 'restRequests', 'saxoRequests', 'secretExposed']);
const COMPLETED = new Set(['CONTINUOUS_QUOTES_OBSERVED', 'SINGLE_QUOTE_ONLY', 'SUBSCRIBE_ACCEPTED_NO_QUOTE_WITHIN_WINDOW']);
const canonical = (value) => JSON.stringify(value, Object.keys(value).sort());
const number = (value, fallback = 0) => value === undefined ? fallback : Number.isFinite(value) && value >= 0 ? value : null;
const nullable = (value) => value === undefined || value === null ? null : number(value, null);

function normalize(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).some((key) => !KEYS.has(key)) || !VERSIONS.has(record.diagnosticVersion)) return null;
  if (record.providerCommissioning !== false || record.decisionImpact !== 'NONE' || record.prospectivePaperAuthorized !== false || record.ordersExecuted !== 0 || record.restRequests !== 0 || record.saxoRequests !== 0 || record.secretExposed !== false) return null;
  if ([record.handshakeAccepted, record.subscribeAccepted].some((value) => typeof value !== 'boolean') || typeof record.classification !== 'string') return null;
  const quoteObserved = record.firstQuoteObserved ?? record.quoteObserved ?? Number(record.quoteMessagesObserved) > 0;
  const normalized = { version: record.diagnosticVersion, handshake: record.handshakeAccepted, subscribe: record.subscribeAccepted,
    quotes: number(record.quoteMessagesObserved, quoteObserved ? 1 : 0), window: nullable(record.observationWindowMs),
    lastQuote: nullable(record.lastQuoteElapsedMs ?? record.elapsedMsToFirstQuote), gap: nullable(record.maxInterQuoteGapMs),
    timestamps: number(record.distinctQuoteEventTimestampCount), outOfOrder: number(record.outOfOrderEventCount),
    closeCode: nullable(record.closeCode), retries: number(record.retries), reconnects: number(record.reconnects),
    redirects: number(record.redirects), classification: record.classification };
  if (Object.entries(normalized).some(([key, value]) => !['lastQuote', 'gap', 'window', 'closeCode'].includes(key) && value === null)) return null;
  if (['lastQuoteElapsedMs', 'elapsedMsToFirstQuote', 'maxInterQuoteGapMs', 'observationWindowMs', 'closeCode'].some((key) => record[key] !== undefined && record[key] !== null && (!Number.isFinite(record[key]) || record[key] < 0))) return null;
  if (normalized.quotes > 0 && normalized.lastQuote === null) return null;
  return normalized;
}

export function evaluateTwelveWsCommissioningReadiness(evidence = []) {
  const input = Array.isArray(evidence) ? evidence : []; const parsed = input.map(normalize); const invalidEvidenceCount = parsed.filter((item) => !item).length;
  const records = [...new Map(parsed.filter(Boolean).map((item) => [canonical(item), item])).values()];
  const transportGate = records.some((item) => item.handshake) ? 'PASS' : 'FAIL';
  const subscriptionGate = records.some((item) => item.subscribe) ? 'PASS' : 'FAIL';
  const maxQuotes = Math.max(0, ...records.map((item) => item.quotes));
  const quoteDeliveryGate = maxQuotes > 1 ? 'MULTIPLE_ARRIVALS_OBSERVED' : maxQuotes === 1 ? 'SINGLE_ARRIVAL_OBSERVED' : 'FAIL';
  const complete = records.filter((item) => item.version === 'twelve-ws-stability-observation-v1' && item.window === COMPLETE_WINDOW_MS && COMPLETED.has(item.classification));
  const observationCompletenessGate = complete.length ? 'PASS' : 'INSUFFICIENT_PREREGISTERED_EVIDENCE';
  const arrivalContinuityGate = records.some((item) => item.quotes > 1 && item.gap !== null) ? 'DESCRIPTIVE_ONLY' : 'INSUFFICIENT_PREREGISTERED_EVIDENCE';
  const eventTimestampProgressionGate = records.some((item) => item.timestamps > 1) ? 'DESCRIPTIVE_ONLY' : 'INSUFFICIENT_PREREGISTERED_EVIDENCE';
  const eventOrderingGate = records.some((item) => item.outOfOrder > 0) ? 'FAIL' : records.length ? 'PASS' : 'UNVERIFIED';
  const connectionIntegrityGate = records.some((item) => item.closeCode !== null || item.retries || item.reconnects || item.redirects) ? 'FAIL' : records.length ? 'PASS' : 'UNVERIFIED';
  const arrivalTailObservationGate = complete.some((item) => item.quotes > 0 && item.lastQuote !== null) ? 'DESCRIPTIVE_ONLY' : 'UNVERIFIED';
  const freshnessCompatibilityGate = 'UNVERIFIED';
  const longitudinalEvidenceGate = 'REQUIRES_PROSPECTIVE_VALIDATION';
  const blockers = [];
  if (invalidEvidenceCount) blockers.push('INVALID_OR_UNSANITIZED_EVIDENCE');
  if (transportGate === 'FAIL') blockers.push('HANDSHAKE_NOT_OBSERVED');
  if (subscriptionGate === 'FAIL') blockers.push('SUBSCRIBE_ACCEPTANCE_NOT_OBSERVED');
  if (quoteDeliveryGate === 'FAIL') blockers.push('QUOTE_DELIVERY_NOT_OBSERVED');
  if (eventOrderingGate === 'FAIL') blockers.push('OUT_OF_ORDER_EVENTS_OBSERVED');
  if (connectionIntegrityGate === 'FAIL') blockers.push('CONNECTION_INTEGRITY_FAILURE');
  let classification = invalidEvidenceCount ? 'DATA_INVALID' : blockers.length ? 'NOT_READY' : 'REQUIRES_PROSPECTIVE_VALIDATION';
  return Object.freeze({ readinessVersion: TWELVE_WS_COMMISSIONING_READINESS_VERSION, provider: 'twelve-ws', symbol: 'EUR/USD',
    evidenceCount: input.length, validDistinctEvidenceCount: records.length, invalidEvidenceCount, frozenQuoteMaxAgeMs: FROZEN_QUOTE_MAX_AGE_MS,
    transportGate, subscriptionGate, quoteDeliveryGate, observationCompletenessGate, arrivalContinuityGate,
    eventTimestampProgressionGate, eventOrderingGate, connectionIntegrityGate, arrivalTailObservationGate, freshnessCompatibilityGate, longitudinalEvidenceGate,
    classification, blockers: Object.freeze(blockers.sort()), providerCommissioning: false, decisionImpact: 'NONE',
    prospectivePaperAuthorized: false, ordersExecuted: 0, externalProviderCalls: 0 });
}
