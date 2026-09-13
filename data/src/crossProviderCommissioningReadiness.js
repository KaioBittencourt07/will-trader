import { composeSaxoClosedOhlcIndependentQuote } from './crossProviderComposition.js';

export const CROSS_PROVIDER_READINESS_VERSION = 'cross-provider-live-commissioning-readiness-prep-v1';
export const CROSS_PROVIDER_BUDGET = Object.freeze({
  sessions: 1, canonicalSymbol: 'EUR/USD', timeframe: '1min', saxoUic: 21, saxoAssetType: 'FxSpot', saxoHorizon: 1,
  twelveSubscriptions: 1, saxoSubscriptions: 1, maxReconnects: 1, retries: 0, freshnessMaxAgeMs: 30_000
});

const allowedEvidence = new Set(['SUBSCRIPTION_INITIAL_SNAPSHOT', 'STREAM_UPDATE_CLOSED_AND_OPENED']);
const bool = (value) => String(value || '').toLowerCase() === 'true';

export function readCrossProviderReadinessConfig(env = {}) {
  const environment = String(env.WILL_SAXO_ENVIRONMENT || '').toLowerCase();
  const enabled = bool(env.WILL_CROSS_PROVIDER_COMMISSIONING_ENABLED);
  const explicit13bAuthorization = env.WILL_CROSS_PROVIDER_AUTHORIZATION === '13B_EXPLICITLY_AUTHORIZED';
  const saxoTokenConfigured = Boolean(env.WILL_SAXO_ACCESS_TOKEN);
  const twelveKeyConfigured = Boolean(env.TWELVE_DATA_API_KEY);
  const reasons = [];
  if (!enabled) reasons.push('COMMISSIONING_DISABLED');
  if (!explicit13bAuthorization) reasons.push('PHASE_13B_NOT_AUTHORIZED');
  if (!['sim', 'live'].includes(environment)) reasons.push('SAXO_ENVIRONMENT_INVALID');
  if (!saxoTokenConfigured) reasons.push('SAXO_TOKEN_MISSING');
  if (!twelveKeyConfigured) reasons.push('TWELVE_KEY_MISSING');
  return Object.freeze({
    enabled, explicit13bAuthorization, environment: ['sim', 'live'].includes(environment) ? environment : 'INVALID',
    saxoTokenConfigured, twelveKeyConfigured, configured: reasons.length === 0,
    symbol: 'EUR/USD', timeframe: '1min', uic: 21, assetType: 'FxSpot', horizon: 1,
    secretsExposed: false, reasonCodes: reasons
  });
}

function boundedCount(value) { return Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0; }

export function buildCrossProviderReadinessReport({ env = {}, saxoSnapshot = null, twelveHealth = null, counters = {}, now = Date.now(), maxAgeMs = 30_000 } = {}) {
  const config = readCrossProviderReadinessConfig(env);
  const reasonCodes = [...config.reasonCodes];
  if (maxAgeMs !== 30_000) reasonCodes.push('FRESHNESS_GATE_FROZEN');
  const reconnects = boundedCount(counters.reconnects);
  const resets = boundedCount(counters.resets);
  const sessions = boundedCount(counters.sessions);
  const saxoRequests = boundedCount(counters.saxoRequests);
  const twelveSubscriptions = boundedCount(counters.twelveSubscriptions);
  if (reconnects > CROSS_PROVIDER_BUDGET.maxReconnects) reasonCodes.push('RECONNECT_BUDGET_EXCEEDED');
  if (sessions > CROSS_PROVIDER_BUDGET.sessions) reasonCodes.push('SESSION_BUDGET_EXCEEDED');
  if (resets > 0) reasonCodes.push('CONTINUITY_RESET_REQUIRES_REQUALIFICATION');
  if (saxoRequests > 0 || twelveSubscriptions > 0) reasonCodes.push('PREP_PHASE_EXTERNAL_CONSUMPTION_FORBIDDEN');

  let composition = null;
  if (saxoSnapshot || twelveHealth) {
    composition = composeSaxoClosedOhlcIndependentQuote({ saxoSnapshot, quoteHealth: twelveHealth, now, maxAgeMs });
    if (composition.compositionState !== 'COMPOSABLE_OFFLINE') reasonCodes.push('PROVIDER_PARTIAL_OR_INVALID_EVIDENCE');
  }
  if (saxoSnapshot && !allowedEvidence.has(saxoSnapshot.sampleEvidence)) reasonCodes.push('SAXO_SAMPLE_CONTEXT_AMBIGUOUS');

  const prepared = config.configured && reasonCodes.length === 0;
  return Object.freeze({
    readinessVersion: CROSS_PROVIDER_READINESS_VERSION,
    result: prepared ? 'LIVE_COMPOSITION_READINESS_PREPARED' : 'BLOCKED_READINESS_PREP',
    valid: false,
    decisionImpact: 'NONE',
    prospectivePaperAuthorized: false,
    phase13bExecuted: false,
    externalCallsPerformed: 0,
    providerConsumption: { twelveObserved: 0, saxoObserved: 0, estimated: 0 },
    configuration: config,
    entitlement: { saxo: 'UNVERIFIED', twelve: 'UNVERIFIED' },
    budget: CROSS_PROVIDER_BUDGET,
    evidenceOwnership: { quoteFreshness: 'TWELVEDATA_WEBSOCKET_EVENT_TIMESTAMP_ONLY', closedOhlc: 'SAXO_DOCUMENTED_COMPLETED_SAMPLE_CONTEXT_ONLY' },
    providerState: {
      twelve: { connected: twelveHealth?.connected === true, quoteFresh: composition?.quoteAgeMs !== null && composition?.quoteAgeMs <= 30_000 },
      saxo: { configuredEnvironment: config.environment, closedCompleteness: saxoSnapshot?.candleCompleteness ?? 'UNVERIFIED' }
    },
    counters: { sessions, saxoRequests, twelveSubscriptions, reconnects, resets },
    composition: composition ? {
      state: composition.compositionState, quoteTimestamp: composition.quoteTimestamp,
      latestClosedCandleTimestamp: composition.latestClosedCandleTimestamp, separation: composition.separation
    } : null,
    reasonCodes: [...new Set(reasonCodes)],
    secretsExposed: false,
    stoppedBeforeExternalAccess: true
  });
}
