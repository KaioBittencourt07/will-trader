import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCrossProviderReadinessReport, CROSS_PROVIDER_BUDGET, readCrossProviderReadinessConfig } from '../data/src/crossProviderCommissioningReadiness.js';
import { transformSaxoChartsOffline } from '../data/src/providers/saxoQualification.js';

const NOW = Date.parse('2026-09-09T12:00:20Z');
const configuredEnv = { WILL_CROSS_PROVIDER_COMMISSIONING_ENABLED: 'true', WILL_CROSS_PROVIDER_AUTHORIZATION: '13B_EXPLICITLY_AUTHORIZED',
  WILL_SAXO_ENVIRONMENT: 'sim', WILL_SAXO_ACCESS_TOKEN: 'synthetic-secret-value', TWELVE_DATA_API_KEY: 'synthetic-key-value' };
function saxo(overrides = {}) {
  const snapshot = transformSaxoChartsOffline({ chartResponse: { ChartInfo: { Horizon: 1, FirstSampleTime: '2020-01-01T00:00:00Z' }, DataVersion: 1,
    Data: [{ Time: '2026-09-09T11:59:00Z', Open: 1.17, High: 1.171, Low: 1.169, Close: 1.1705 }] },
    sampleEvidence: 'SUBSCRIPTION_INITIAL_SNAPSHOT', receivedAt: '2026-09-09T12:00:19Z' });
  return { ...snapshot, sampleEvidence: 'SUBSCRIPTION_INITIAL_SNAPSHOT', ...overrides };
}
function twelve(tick = {}) { return { mode: 'SHADOW_OBSERVABILITY', connected: true, subscriptionsAccepted: 1, subscriptionsRejected: 0,
  symbols: [{ symbol: 'EUR/USD', price: 1.1706, eventTimestamp: NOW - 5_000, receivedAt: new Date(NOW - 1_000).toISOString(), ...tick }] }; }
function authority(eventTimestamp = NOW - 5_000, overrides = {}) {
  return {
    source: 'synthetic-independent-time-source', symbol: 'EUR/USD', timestampAuthority: 'PROVIDER_EVENT_TIME',
    authorityGate: 'PASS', freshnessGate: 'PASS', freshnessContractMs: 30_000, eventTimestamp, ...overrides
  };
}

const reportWithEvidence = ({ twelveHealth = twelve(), quoteTemporalAuthority = authority(), ...rest } = {}) =>
  buildCrossProviderReadinessReport({ env: configuredEnv, saxoSnapshot: saxo(), twelveHealth, quoteTemporalAuthority, now: NOW, ...rest });

test('missing config and tokens block before external access', () => {
  const report = buildCrossProviderReadinessReport({ env: {} });
  assert.equal(report.result, 'BLOCKED_READINESS_PREP');
  assert.ok(report.reasonCodes.includes('COMMISSIONING_DISABLED'));
  assert.ok(report.reasonCodes.includes('SAXO_TOKEN_MISSING'));
  assert.equal(report.externalCallsPerformed, 0);
});

test('invalid environment and frozen symbol/timeframe contract are explicit', () => {
  const config = readCrossProviderReadinessConfig({ ...configuredEnv, WILL_SAXO_ENVIRONMENT: 'practice' });
  assert.equal(config.environment, 'INVALID');
  assert.ok(config.reasonCodes.includes('SAXO_ENVIRONMENT_INVALID'));
  assert.deepEqual([config.symbol, config.timeframe, config.uic, config.assetType, config.horizon], ['EUR/USD', '1min', 21, 'FxSpot', 1]);
});

test('Saxo entitlement remains unknown even in prepared config', () => {
  const report = buildCrossProviderReadinessReport({ env: configuredEnv });
  assert.equal(report.result, 'LIVE_COMPOSITION_READINESS_PREPARED');
  assert.equal(report.entitlement.saxo, 'UNVERIFIED');
});

test('ambiguous Saxo sample blocks readiness evidence', () => {
  const report = buildCrossProviderReadinessReport({ env: configuredEnv, saxoSnapshot: saxo({ sampleEvidence: 'REST_GET', candleCompleteness: 'UNVERIFIED' }),
    twelveHealth: twelve(), quoteTemporalAuthority: authority(), now: NOW });
  assert.ok(report.reasonCodes.includes('SAXO_SAMPLE_CONTEXT_AMBIGUOUS'));
  assert.equal(report.result, 'BLOCKED_READINESS_PREP');
});

test('qualified quote plus independent temporal authority is composable offline', () => {
  assert.equal(reportWithEvidence().composition.state, 'COMPOSABLE_OFFLINE');
});

test('missing independent temporal authority fails closed even when quote transport is healthy', () => {
  const report = reportWithEvidence({ quoteTemporalAuthority: null });
  assert.equal(report.composition.state, 'INVALID');
  assert.ok(report.reasonCodes.includes('PROVIDER_PARTIAL_OR_INVALID_EVIDENCE'));
});

test('Twelve disconnected, stale and future authority timestamps fail closed', () => {
  const disconnected = twelve(); disconnected.connected = false;
  assert.ok(reportWithEvidence({ twelveHealth: disconnected }).reasonCodes.includes('PROVIDER_PARTIAL_OR_INVALID_EVIDENCE'));
  assert.ok(reportWithEvidence({
    twelveHealth: twelve({ eventTimestamp: NOW - 30_001 }),
    quoteTemporalAuthority: authority(NOW - 30_001, { freshnessGate: 'FAIL' })
  }).reasonCodes.includes('PROVIDER_PARTIAL_OR_INVALID_EVIDENCE'));
  assert.ok(reportWithEvidence({
    twelveHealth: twelve({ eventTimestamp: NOW + 1_001 }),
    quoteTemporalAuthority: authority(NOW + 1_001)
  }).reasonCodes.includes('PROVIDER_PARTIAL_OR_INVALID_EVIDENCE'));
});

test('receive time cannot rejuvenate native quote timestamp', () => {
  const eventTimestamp = NOW - 40_000;
  const report = reportWithEvidence({
    twelveHealth: twelve({ eventTimestamp, receivedAt: new Date(NOW).toISOString() }),
    quoteTemporalAuthority: authority(eventTimestamp, { freshnessGate: 'FAIL' })
  });
  assert.equal(report.composition.quoteTimestamp, new Date(eventTimestamp).toISOString());
  assert.equal(report.result, 'BLOCKED_READINESS_PREP');
});

test('reconnect/reset counters are observable and continuity fails closed', () => {
  const reconnect = buildCrossProviderReadinessReport({ env: configuredEnv, counters: { reconnects: 2 } });
  assert.ok(reconnect.reasonCodes.includes('RECONNECT_BUDGET_EXCEEDED'));
  const reset = buildCrossProviderReadinessReport({ env: configuredEnv, counters: { resets: 1 } });
  assert.ok(reset.reasonCodes.includes('CONTINUITY_RESET_REQUIRES_REQUALIFICATION'));
  const sessions = buildCrossProviderReadinessReport({ env: configuredEnv, counters: { sessions: 2 } });
  assert.ok(sessions.reasonCodes.includes('SESSION_BUDGET_EXCEEDED'));
});

test('provider partial failure remains blocked', () => {
  const report = buildCrossProviderReadinessReport({ env: configuredEnv, saxoSnapshot: saxo(), twelveHealth: null, quoteTemporalAuthority: authority(), now: NOW });
  assert.ok(report.reasonCodes.includes('PROVIDER_PARTIAL_OR_INVALID_EVIDENCE'));
});

test('happy-path PREP report stays non-authoritative and consumes zero provider', () => {
  const report = reportWithEvidence();
  assert.equal(report.result, 'LIVE_COMPOSITION_READINESS_PREPARED');
  assert.equal(report.valid, false);
  assert.equal(report.decisionImpact, 'NONE');
  assert.equal(report.prospectivePaperAuthorized, false);
  assert.deepEqual(report.providerConsumption, { twelveObserved: 0, saxoObserved: 0, estimated: 0 });
  assert.equal(report.providerState.temporalAuthority.authorityGate, 'PASS');
  assert.equal(report.providerState.temporalAuthority.freshnessGate, 'PASS');
});

test('readiness output redacts secrets by construction', () => {
  const encoded = JSON.stringify(buildCrossProviderReadinessReport({ env: configuredEnv }));
  assert.equal(encoded.includes('synthetic-secret-value'), false);
  assert.equal(encoded.includes('synthetic-key-value'), false);
  assert.equal(JSON.parse(encoded).secretsExposed, false);
});

test('30-second gate and operational budget are frozen', () => {
  assert.equal(CROSS_PROVIDER_BUDGET.freshnessMaxAgeMs, 30_000);
  const report = buildCrossProviderReadinessReport({ env: configuredEnv, maxAgeMs: 30_001 });
  assert.ok(report.reasonCodes.includes('FRESHNESS_GATE_FROZEN'));
  assert.equal(report.result, 'BLOCKED_READINESS_PREP');
});
