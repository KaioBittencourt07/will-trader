import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateTwelveWsCommissioningReadiness, FROZEN_QUOTE_MAX_AGE_MS } from '../backend/src/twelveWsCommissioningReadiness.js';

const r8f = { diagnosticVersion: 'twelve-ws-stability-observation-v1', connections: 1, handshakeAccepted: true,
  subscribeAttempts: 1, subscribeAccepted: true, observationWindowMs: 60000, preAcceptTimeoutMs: 5000,
  heartbeatIntervalMs: 10000, heartbeatsSent: 5, quoteMessagesObserved: 30, firstQuoteElapsedMs: 166,
  lastQuoteElapsedMs: 59049, maxInterQuoteGapMs: 4922, distinctQuoteEventTimestampCount: 2, outOfOrderEventCount: 0,
  nonPriceMessagesObserved: 6, closeCode: null, retries: 0, reconnects: 0, redirects: 0, applicationMessagesSent: 6,
  classification: 'CONTINUOUS_QUOTES_OBSERVED', causeConfirmed: true, providerCommissioning: false, decisionImpact: 'NONE',
  prospectivePaperAuthorized: false, ordersExecuted: 0, restRequests: 0, saxoRequests: 0, secretExposed: false };
const r8d = { diagnosticVersion: 'twelve-heartbeat-observation-v1', handshakeAccepted: true, subscribeAccepted: true,
  firstQuoteObserved: true, quoteMessagesObserved: 1, elapsedMsToFirstQuote: 477, observationWindowMs: 60000,
  closeCode: null, retries: 0, reconnects: 0, redirects: 0, classification: 'QUOTE_OBSERVED_WITH_HEARTBEAT_SESSION',
  providerCommissioning: false, decisionImpact: 'NONE', prospectivePaperAuthorized: false, ordersExecuted: 0,
  restRequests: 0, saxoRequests: 0, secretExposed: false };
const r8c = { ...r8d, diagnosticVersion: 'twelve-post-subscribe-observation-v1', firstQuoteObserved: false,
  quoteMessagesObserved: 0, elapsedMsToFirstQuote: null, classification: 'SUBSCRIBE_ACCEPTED_NO_QUOTE_WITHIN_WINDOW' };

test('malformed, raw, secret-bearing and authority-changing evidence fails closed', () => {
  for (const value of [null, { ...r8f, apiKey: 'secret' }, { ...r8f, rawPrice: 1.2 }, { ...r8f, providerCommissioning: true }]) {
    const report = evaluateTwelveWsCommissioningReadiness([value]); assert.equal(report.classification, 'DATA_INVALID'); assert.equal(report.externalProviderCalls, 0);
  }
});
test('handshake, subscription, zero quote and one quote gates fail conservatively', () => {
  assert.equal(evaluateTwelveWsCommissioningReadiness([{ ...r8f, handshakeAccepted: false }]).transportGate, 'FAIL');
  assert.equal(evaluateTwelveWsCommissioningReadiness([{ ...r8f, subscribeAccepted: false }]).subscriptionGate, 'FAIL');
  assert.equal(evaluateTwelveWsCommissioningReadiness([{ ...r8f, quoteMessagesObserved: 0, lastQuoteElapsedMs: null }]).classification, 'NOT_READY');
  const one = evaluateTwelveWsCommissioningReadiness([{ ...r8f, quoteMessagesObserved: 1 }]); assert.equal(one.quoteDeliveryGate, 'SINGLE_ARRIVAL_OBSERVED'); assert.equal(one.providerCommissioning, false);
});
test('multiple arrivals stay descriptive and require prospective validation', () => {
  const report = evaluateTwelveWsCommissioningReadiness([r8f]); assert.equal(report.quoteDeliveryGate, 'MULTIPLE_ARRIVALS_OBSERVED');
  assert.equal(report.arrivalContinuityGate, 'DESCRIPTIVE_ONLY'); assert.equal(report.classification, 'REQUIRES_PROSPECTIVE_VALIDATION');
});
test('out-of-order events and connection integrity violations are not ready', () => {
  assert.equal(evaluateTwelveWsCommissioningReadiness([{ ...r8f, outOfOrderEventCount: 1 }]).classification, 'NOT_READY');
  for (const patch of [{ retries: 1 }, { reconnects: 1 }, { redirects: 1 }, { closeCode: 1006 }]) assert.equal(evaluateTwelveWsCommissioningReadiness([{ ...r8f, ...patch }]).connectionIntegrityGate, 'FAIL');
});
test('incomplete window requires preregistered evidence', () => {
  const report = evaluateTwelveWsCommissioningReadiness([{ ...r8f, observationWindowMs: 59999 }]);
  assert.equal(report.observationCompletenessGate, 'INSUFFICIENT_PREREGISTERED_EVIDENCE'); assert.equal(report.classification, 'REQUIRES_PROSPECTIVE_VALIDATION');
});
test('late local arrival cannot prove provider event freshness', () => {
  assert.equal(FROZEN_QUOTE_MAX_AGE_MS, 30000);
  for (const lastQuoteElapsedMs of [29999, 30000, 59999]) {
    const report = evaluateTwelveWsCommissioningReadiness([{ ...r8f, lastQuoteElapsedMs }]);
    assert.equal(report.arrivalTailObservationGate, 'DESCRIPTIVE_ONLY'); assert.equal(report.freshnessCompatibilityGate, 'UNVERIFIED');
  }
});
test('historical R8C R8D R8F fixtures cannot commission or authorize PAPER', () => {
  const report = evaluateTwelveWsCommissioningReadiness([r8c, r8d, r8f]); assert.equal(report.classification, 'REQUIRES_PROSPECTIVE_VALIDATION');
  assert.equal(report.longitudinalEvidenceGate, 'REQUIRES_PROSPECTIVE_VALIDATION'); assert.equal(report.providerCommissioning, false);
  assert.equal(report.arrivalTailObservationGate, 'DESCRIPTIVE_ONLY'); assert.equal(report.freshnessCompatibilityGate, 'UNVERIFIED');
  assert.equal(report.prospectivePaperAuthorized, false); assert.equal(report.decisionImpact, 'NONE'); assert.equal(report.ordersExecuted, 0); assert.equal(report.externalProviderCalls, 0);
});
test('output is allowlisted and never carries raw provider values or secrets', () => {
  const text = JSON.stringify(evaluateTwelveWsCommissioningReadiness([r8f]));
  for (const forbidden of ['9.99', 'apikey=', 'wss://', 'SYNTHETIC_SECRET', '59049']) assert.equal(text.includes(forbidden), false);
});
