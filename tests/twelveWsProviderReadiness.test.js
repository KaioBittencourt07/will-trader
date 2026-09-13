import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateTwelveWsProviderReadiness } from '../backend/src/twelveWsProviderReadiness.js';

const base = { diagnosticVersion: 'twelve-heartbeat-observation-v1', connections: 1, handshakeAccepted: true,
  subscribeSent: true, subscribeAttempts: 1, subscribeAccepted: true, firstQuoteObserved: true,
  quoteMessagesObserved: 1, elapsedMsToSubscribeStatus: 609, elapsedMsToFirstQuote: 477,
  observationWindowMs: 60000, preAcceptTimeoutMs: 5000, heartbeatsSent: 0, heartbeatIntervalMs: 10000,
  closeCode: null, retries: 0, reconnects: 0, redirects: 0, applicationMessagesSent: 1,
  classification: 'QUOTE_OBSERVED_WITH_HEARTBEAT_SESSION', causeConfirmed: true,
  providerCommissioning: false, decisionImpact: 'NONE', prospectivePaperAuthorized: false, ordersExecuted: 0,
  restRequests: 0, saxoRequests: 0, secretExposed: false };
const noQuote = { ...base, diagnosticVersion: 'twelve-post-subscribe-observation-v1', firstQuoteObserved: false,
  quoteMessagesObserved: 0, elapsedMsToFirstQuote: null, heartbeatsSent: 0, heartbeatIntervalMs: null,
  classification: 'SUBSCRIBE_ACCEPTED_NO_QUOTE_WITHIN_WINDOW', causeConfirmed: false };

test('no evidence is insufficient and handshake-only observes reachability', () => {
  assert.equal(evaluateTwelveWsProviderReadiness([]).readiness, 'INSUFFICIENT_EVIDENCE');
  const handshake = { ...base, subscribeAccepted: false, firstQuoteObserved: false, quoteMessagesObserved: 0, elapsedMsToFirstQuote: null, classification: 'POST_UPGRADE_TIMEOUT', causeConfirmed: false };
  assert.equal(evaluateTwelveWsProviderReadiness([handshake]).readiness, 'REACHABILITY_OBSERVED');
});

test('one quote proves delivery but never stability or commissioning', () => {
  const result = evaluateTwelveWsProviderReadiness([base]); assert.equal(result.readiness, 'QUOTE_DELIVERY_OBSERVED');
  assert.equal(result.stabilityStatus, 'NOT_ESTABLISHED'); assert.equal(result.providerCommissioning, false);
  assert.equal(result.prospectivePaperAuthorized, false); assert.equal(result.decisionImpact, 'NONE'); assert.equal(result.ordersExecuted, 0);
});

test('frozen R8C plus R8D evidence is intermittent', () => {
  const result = evaluateTwelveWsProviderReadiness([noQuote, base]); assert.equal(result.readiness, 'INTERMITTENT_BEHAVIOR_OBSERVED');
  assert.equal(result.quoteSuccessCount, 1); assert.equal(result.quoteFailureCount, 1); assert.deepEqual([result.minElapsedMsToFirstQuote, result.medianElapsedMsToFirstQuote, result.maxElapsedMsToFirstQuote], [477, 477, 477]);
});

test('explicit auth rejection and protocol uncertainty block conservatively', () => {
  const auth = { ...base, subscribeAccepted: false, firstQuoteObserved: false, quoteMessagesObserved: 0, elapsedMsToFirstQuote: null, classification: 'APPLICATION_AUTH_OR_ENTITLEMENT_REJECTED' };
  assert.equal(evaluateTwelveWsProviderReadiness([auth]).readiness, 'BLOCKED_AUTH_OR_ENTITLEMENT');
  const protocol = { ...auth, classification: 'APPLICATION_PROTOCOL_INCONCLUSIVE', causeConfirmed: false };
  assert.equal(evaluateTwelveWsProviderReadiness([protocol]).readiness, 'BLOCKED_PROTOCOL');
});

test('abnormal close mixed with success is intermittent', () => {
  const close = { ...noQuote, closeCode: 1006, classification: 'POST_SUBSCRIBE_ABNORMAL_CLOSE' };
  const result = evaluateTwelveWsProviderReadiness([base, close]); assert.equal(result.abnormalCloseCount, 1); assert.equal(result.readiness, 'INTERMITTENT_BEHAVIOR_OBSERVED');
});

test('identical evidence is deduplicated while latest fields preserve input order', () => {
  const one = evaluateTwelveWsProviderReadiness([base, noQuote, base]); const two = evaluateTwelveWsProviderReadiness([noQuote, base, base]);
  assert.equal(one.validEvidenceCount, 2); assert.equal(two.validEvidenceCount, 2);
  assert.equal(one.latestEvidenceClassification, noQuote.classification); assert.equal(one.latestQuoteObserved, false);
  assert.equal(two.latestEvidenceClassification, base.classification); assert.equal(two.latestQuoteObserved, true);
  const omitLatest = ({ latestEvidenceClassification, latestQuoteObserved, ...result }) => result;
  assert.deepEqual(omitLatest(one), omitLatest(two));
});

test('raw, secret-bearing, malformed and authority-changing records fail closed', () => {
  for (const invalid of [{ ...base, rawFrame: 'secret' }, { ...base, apiKey: 'secret' }, { ...base, ordersExecuted: 1 }, { ...base, elapsedMsToFirstQuote: -1 }]) {
    const result = evaluateTwelveWsProviderReadiness([invalid]); assert.equal(result.readiness, 'BLOCKED_PROTOCOL'); assert.equal(result.validEvidenceCount, 0);
  }
});

test('R8B and R8C field variants normalize backward-compatibly', () => {
  const r8b = { ...base, diagnosticVersion: 'twelve-post-101-diagnostic-v1', quoteObserved: true, firstQuoteObserved: undefined,
    quoteMessagesObserved: undefined, elapsedMsToFirstQuote: undefined, observationWindowMs: undefined, preAcceptTimeoutMs: undefined,
    heartbeatsSent: undefined, heartbeatIntervalMs: undefined, redirects: undefined, classification: 'HANDSHAKE_ACCEPTED_SUBSCRIBE_ACCEPTED_QUOTE_OBSERVED' };
  assert.equal(evaluateTwelveWsProviderReadiness([r8b]).readiness, 'QUOTE_DELIVERY_OBSERVED');
  assert.equal(evaluateTwelveWsProviderReadiness([noQuote]).readiness, 'REACHABILITY_OBSERVED');
});
