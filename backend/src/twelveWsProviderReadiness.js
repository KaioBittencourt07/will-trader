export const TWELVE_WS_PROVIDER_READINESS_VERSION = 'twelve-ws-provider-readiness-v1';

const VERSIONS = new Set(['twelve-post-101-diagnostic-v1', 'twelve-post-subscribe-observation-v1', 'twelve-heartbeat-observation-v1']);
const CLASSIFICATIONS = new Set(['HANDSHAKE_ACCEPTED_SUBSCRIBE_ACCEPTED_QUOTE_OBSERVED', 'SUBSCRIBE_ACCEPTED_QUOTE_TIMEOUT',
  'QUOTE_OBSERVED_WITHIN_WINDOW', 'SUBSCRIBE_ACCEPTED_NO_QUOTE_WITHIN_WINDOW', 'QUOTE_OBSERVED_WITH_HEARTBEAT_SESSION',
  'SUBSCRIBE_ACCEPTED_NO_QUOTE_WITH_HEARTBEATS', 'POST_SUBSCRIBE_ABNORMAL_CLOSE', 'POST_UPGRADE_ABNORMAL_CLOSE',
  'POST_UPGRADE_TIMEOUT', 'PRE_ACCEPT_TIMEOUT', 'APPLICATION_AUTH_OR_ENTITLEMENT_REJECTED',
  'APPLICATION_PROTOCOL_INCONCLUSIVE', 'APPLICATION_PROTOCOL_UNRECOGNIZED', 'POST_UPGRADE_INCONCLUSIVE', 'SUBSCRIBE_REJECTED']);
const KEYS = new Set(['diagnosticVersion', 'connections', 'handshakeStatus', 'handshakeAccepted', 'subscribeSent',
  'subscribeAttempts', 'subscribeStatusObserved', 'subscribeAccepted', 'firstQuoteObserved', 'quoteObserved',
  'quoteMessagesObserved', 'quoteEventType', 'quoteTimestampPresent', 'elapsedMsToSubscribeStatus', 'elapsedMsToFirstQuote',
  'observationWindowMs', 'preAcceptTimeoutMs', 'heartbeatsSent', 'heartbeatIntervalMs', 'closeCode', 'retries',
  'reconnects', 'redirects', 'applicationMessagesSent', 'classification', 'causeConfirmed', 'providerCommissioning',
  'decisionImpact', 'prospectivePaperAuthorized', 'ordersExecuted', 'restRequests', 'saxoRequests', 'secretExposed']);
const nonnegative = (value, fallback = 0) => value === undefined ? fallback : Number.isFinite(value) && value >= 0 ? value : null;
const nullableNonnegative = (value) => value === undefined || value === null ? null : nonnegative(value, null);
const canonical = (value) => JSON.stringify(value, Object.keys(value).sort());

function normalize(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).some((key) => !KEYS.has(key))) return null;
  if (!VERSIONS.has(record.diagnosticVersion) || !CLASSIFICATIONS.has(record.classification)) return null;
  if (record.providerCommissioning !== false || record.decisionImpact !== 'NONE' || record.prospectivePaperAuthorized !== false ||
      record.ordersExecuted !== 0 || record.restRequests !== 0 || record.saxoRequests !== 0 || record.secretExposed !== false) return null;
  if (['elapsedMsToSubscribeStatus', 'elapsedMsToFirstQuote', 'observationWindowMs', 'preAcceptTimeoutMs', 'heartbeatIntervalMs', 'closeCode']
    .some((key) => record[key] !== undefined && record[key] !== null && (!Number.isFinite(record[key]) || record[key] < 0))) return null;
  const quoteObserved = record.firstQuoteObserved ?? record.quoteObserved ?? false;
  const values = { connections: nonnegative(record.connections, record.handshakeAccepted ? 1 : 0),
    subscribeAttempts: nonnegative(record.subscribeAttempts), quoteMessagesObserved: nonnegative(record.quoteMessagesObserved, quoteObserved ? 1 : 0),
    elapsedMsToSubscribeStatus: nullableNonnegative(record.elapsedMsToSubscribeStatus), elapsedMsToFirstQuote: nullableNonnegative(record.elapsedMsToFirstQuote),
    observationWindowMs: nullableNonnegative(record.observationWindowMs), preAcceptTimeoutMs: nullableNonnegative(record.preAcceptTimeoutMs),
    heartbeatsSent: nonnegative(record.heartbeatsSent), heartbeatIntervalMs: nullableNonnegative(record.heartbeatIntervalMs),
    closeCode: nullableNonnegative(record.closeCode), retries: nonnegative(record.retries), reconnects: nonnegative(record.reconnects),
    redirects: nonnegative(record.redirects), applicationMessagesSent: nonnegative(record.applicationMessagesSent) };
  if (['connections', 'subscribeAttempts', 'quoteMessagesObserved', 'heartbeatsSent', 'retries', 'reconnects', 'redirects', 'applicationMessagesSent'].some((key) => values[key] === null)) return null;
  if ([record.handshakeAccepted, record.subscribeSent, record.subscribeAccepted, quoteObserved, record.causeConfirmed].some((value) => typeof value !== 'boolean')) return null;
  if (quoteObserved && values.quoteMessagesObserved < 1) return null;
  return { diagnosticVersion: record.diagnosticVersion, connections: values.connections, handshakeAccepted: record.handshakeAccepted,
    subscribeSent: record.subscribeSent, subscribeAttempts: values.subscribeAttempts, subscribeAccepted: record.subscribeAccepted,
    quoteObserved, quoteMessagesObserved: values.quoteMessagesObserved, elapsedMsToSubscribeStatus: values.elapsedMsToSubscribeStatus,
    elapsedMsToFirstQuote: values.elapsedMsToFirstQuote, observationWindowMs: values.observationWindowMs,
    preAcceptTimeoutMs: values.preAcceptTimeoutMs, heartbeatsSent: values.heartbeatsSent, heartbeatIntervalMs: values.heartbeatIntervalMs,
    closeCode: values.closeCode, retries: values.retries, reconnects: values.reconnects, redirects: values.redirects,
    applicationMessagesSent: values.applicationMessagesSent, classification: record.classification, causeConfirmed: record.causeConfirmed };
}

const median = (numbers) => { if (!numbers.length) return null; const middle = Math.floor(numbers.length / 2); return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2; };

export function evaluateTwelveWsProviderReadiness(evidence = []) {
  const records = Array.isArray(evidence) ? evidence : []; const normalized = records.map(normalize); const invalid = normalized.filter((item) => !item).length;
  const unique = [...new Map(normalized.filter(Boolean).map((item) => [canonical(item), item])).values()].sort((a, b) => canonical(a).localeCompare(canonical(b)));
  const quoteSuccessCount = unique.filter((item) => item.quoteObserved).length;
  const quoteFailureCount = unique.filter((item) => item.subscribeAccepted && !item.quoteObserved).length;
  const abnormalCloseCount = unique.filter((item) => item.classification.includes('ABNORMAL_CLOSE')).length;
  const protocolInconclusiveCount = unique.filter((item) => item.classification.includes('PROTOCOL_INCONCLUSIVE') || item.classification.includes('PROTOCOL_UNRECOGNIZED')).length;
  const authOrEntitlementRejectCount = unique.filter((item) => item.classification === 'APPLICATION_AUTH_OR_ENTITLEMENT_REJECTED').length;
  const times = unique.filter((item) => item.quoteObserved && item.elapsedMsToFirstQuote !== null).map((item) => item.elapsedMsToFirstQuote).sort((a, b) => a - b);
  const blockers = []; const warnings = [];
  let readiness = 'INSUFFICIENT_EVIDENCE'; let stabilityStatus = 'INSUFFICIENT';
  if (invalid) { blockers.push('INVALID_OR_NON_SANITIZED_EVIDENCE'); readiness = 'BLOCKED_PROTOCOL'; stabilityStatus = 'BLOCKED'; }
  else if (authOrEntitlementRejectCount) { blockers.push('EXPLICIT_AUTH_OR_ENTITLEMENT_REJECTION'); readiness = 'BLOCKED_AUTH_OR_ENTITLEMENT'; stabilityStatus = 'BLOCKED'; }
  else if (protocolInconclusiveCount) { blockers.push('PROTOCOL_EVIDENCE_INCONCLUSIVE'); readiness = 'BLOCKED_PROTOCOL'; stabilityStatus = 'BLOCKED'; }
  else if (quoteSuccessCount && (quoteFailureCount || abnormalCloseCount)) { warnings.push('QUOTE_DELIVERY_NOT_CONSISTENT'); readiness = 'INTERMITTENT_BEHAVIOR_OBSERVED'; stabilityStatus = 'INTERMITTENT'; }
  else if (quoteSuccessCount) { warnings.push('CONTINUOUS_RELIABILITY_NOT_ESTABLISHED'); readiness = 'QUOTE_DELIVERY_OBSERVED'; stabilityStatus = 'NOT_ESTABLISHED'; }
  else if (unique.some((item) => item.handshakeAccepted)) { warnings.push('QUOTE_DELIVERY_NOT_OBSERVED'); readiness = 'REACHABILITY_OBSERVED'; stabilityStatus = 'NOT_ESTABLISHED'; }
  const latest = unique.at(-1) ?? null;
  return Object.freeze({ readinessVersion: TWELVE_WS_PROVIDER_READINESS_VERSION, provider: 'twelve-ws', symbol: 'EUR/USD',
    evidenceCount: records.length, validEvidenceCount: unique.length, quoteSuccessCount, quoteFailureCount, abnormalCloseCount,
    protocolInconclusiveCount, authOrEntitlementRejectCount, minElapsedMsToFirstQuote: times.at(0) ?? null,
    medianElapsedMsToFirstQuote: median(times), maxElapsedMsToFirstQuote: times.at(-1) ?? null,
    latestEvidenceClassification: latest?.classification ?? null, latestQuoteObserved: latest?.quoteObserved ?? false,
    stabilityStatus, readiness, blockers: Object.freeze(blockers.sort()), warnings: Object.freeze(warnings.sort()),
    causeConfirmed: readiness === 'BLOCKED_AUTH_OR_ENTITLEMENT' || readiness === 'QUOTE_DELIVERY_OBSERVED', providerCommissioning: false, decisionImpact: 'NONE',
    prospectivePaperAuthorized: false, ordersExecuted: 0 });
}
