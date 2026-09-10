import { createTwelveWebSocketFeed } from '../../data/src/providers/twelveWebSocketFeed.js';
import { diagnoseSaxoChartSnapshotStructure, transformSaxoBidAskChartsOffline, transformSaxoChartsOffline, classifySaxoFailure } from '../../data/src/providers/saxoQualification.js';
import { composeSaxoBidAskIndependentQuote, composeSaxoClosedOhlcIndependentQuote } from '../../data/src/crossProviderComposition.js';

export const CROSS_PROVIDER_COMMISSIONING_VERSION = 'cross-provider-readonly-commissioning-v1';
const CHAMPION_COMPOSITION_VERSION = 'saxo-closed-ohlc-independent-quote-v1';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const safeCode = (error) => error?.code || classifySaxoFailure(error);

export function extractSaxoSubscriptionSnapshot(payload) {
  if (!payload || typeof payload !== 'object' || !payload.Snapshot || typeof payload.Snapshot !== 'object') {
    const error = new Error('SAXO_SUBSCRIPTION_SNAPSHOT_MISSING'); error.code = 'SAXO_SUBSCRIPTION_SNAPSHOT_MISSING'; throw error;
  }
  return payload.Snapshot;
}

export function buildSaxoSubscriptionBody({ contextId, referenceId }) {
  return { ContextId: contextId, ReferenceId: referenceId, Format: 'application/json',
    Arguments: { Uic: 21, AssetType: 'FxSpot', Horizon: 1, Count: 50,
      ChartSampleFieldSet: 'Default', FieldGroups: ['ChartInfo', 'Data'] } };
}

export function commissioningConfiguration(env = {}) {
  const reasons = [];
  const enabled = env.WILL_CROSS_PROVIDER_COMMISSIONING_ENABLED === 'true';
  const authorized = env.WILL_CROSS_PROVIDER_AUTHORIZATION === '13B_EXPLICITLY_AUTHORIZED';
  const sim = String(env.WILL_SAXO_ENVIRONMENT || '').toLowerCase() === 'sim';
  const saxoTokenConfigured = Boolean(env.WILL_SAXO_ACCESS_TOKEN);
  const twelveKeyConfigured = Boolean(env.TWELVE_DATA_API_KEY);
  if (!enabled) reasons.push('COMMISSIONING_DISABLED');
  if (!authorized) reasons.push('PHASE_13B_NOT_AUTHORIZED');
  if (!sim) reasons.push('SAXO_SIM_REQUIRED');
  if (!saxoTokenConfigured) reasons.push('SAXO_TOKEN_MISSING');
  if (!twelveKeyConfigured) reasons.push('TWELVE_KEY_MISSING');
  return { enabled, authorized, environment: sim ? 'sim' : 'INVALID', saxoTokenConfigured, twelveKeyConfigured,
    ready: reasons.length === 0, reasonCodes: reasons, secretExposed: false };
}

async function subscribeSaxoSim({ token, fetchImpl, contextId, referenceId, now }) {
  const response = await fetchImpl('https://gateway.saxobank.com/sim/openapi/chart/v3/charts/subscriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildSaxoSubscriptionBody({ contextId, referenceId }))
  });
  if (!response.ok) { const error = new Error('SAXO_SUBSCRIPTION_REJECTED'); error.status = response.status; throw error; }
  const payload = await response.json();
  const chartResponse = extractSaxoSubscriptionSnapshot(payload);
  try {
    const structure = diagnoseSaxoChartSnapshotStructure(chartResponse);
    const transformer = structure.classification === 'BID_ASK_OHLC' ? transformSaxoBidAskChartsOffline : transformSaxoChartsOffline;
    return transformer({ chartResponse, sampleEvidence: 'SUBSCRIPTION_INITIAL_SNAPSHOT', receivedAt: new Date(now()).toISOString() });
  } catch (error) {
    error.saxoStructure = diagnoseSaxoChartSnapshotStructure(chartResponse);
    throw error;
  }
}

export function describeWebSocketRuntime(WebSocketCtor = globalThis.WebSocket) {
  return Object.freeze({ available: typeof WebSocketCtor === 'function', api: typeof WebSocketCtor === 'function' ? 'EVENT_TARGET_WEBSOCKET' : 'UNAVAILABLE',
    implementation: typeof WebSocketCtor?.name === 'string' ? WebSocketCtor.name.slice(0, 60) : null, secretExposed: false });
}

export async function runCrossProviderCommissioning({ env = process.env, fetchImpl = fetch,
  webSocketFactory = typeof globalThis.WebSocket === 'function' ? (url) => new globalThis.WebSocket(url) : null,
  wait = sleep, now = () => Date.now(), durationMs = 15_000, saxoSubscribe = subscribeSaxoSim } = {}) {
  const configuration = commissioningConfiguration(env);
  const base = { commissioningVersion: CROSS_PROVIDER_COMMISSIONING_VERSION, configuration, canonicalSymbol: 'EUR/USD', timeframe: '1min',
    gateMs: 30_000, decisionImpact: 'NONE', prospectivePaperAuthorized: false, ordersExecuted: 0, sessions: 0,
    webSocketRuntime: describeWebSocketRuntime(webSocketFactory), secretExposed: false };
  if (!configuration.ready) return { ...base, result: 'BLOCKED_EXTERNAL', reasonCodes: configuration.reasonCodes,
    twelve: { connections: 0, subscriptions: 0 }, saxo: { subscriptions: 0 }, stoppedBeforeExternalAccess: true };
  if (typeof webSocketFactory !== 'function') return { ...base, result: 'BLOCKED_EXTERNAL',
    reasonCodes: ['TWELVE_WEBSOCKET_RUNTIME_UNAVAILABLE'], twelve: { connections: 0, subscriptions: 0, reconnects: 0 },
    saxo: { subscriptions: 0 }, stoppedBeforeExternalAccess: true };

  const boundedDuration = Math.min(30_000, Math.max(5_000, Number(durationMs) || 15_000));
  const contextId = `will13b-${now()}`;
  const referenceId = 'WILL13BCHART';
  const feed = createTwelveWebSocketFeed({ enabled: true, apiKey: env.TWELVE_DATA_API_KEY, symbols: ['EUR/USD'],
    webSocketFactory, staleAfterMs: 30_000, maxReconnects: 1, maxSubscriptionRequests: 1, now, logger: () => {} });
  let saxoSnapshot = null;
  let saxoReason = null;
  let saxoStructure = null;
  let twelveHealth;
  feed.start();
  try {
    try { saxoSnapshot = await saxoSubscribe({ token: env.WILL_SAXO_ACCESS_TOKEN, fetchImpl, contextId, referenceId, now }); }
    catch (error) { saxoReason = safeCode(error); saxoStructure = error.saxoStructure ?? null; }
    await wait(boundedDuration);
  } finally { twelveHealth = feed.health(); feed.stop(); }

  const reasons = [];
  if (saxoReason) reasons.push(saxoReason.startsWith('SAXO_') ? saxoReason : `SAXO_${saxoReason}`);
  if (!saxoSnapshot) reasons.push('SAXO_CLOSED_OHLC_UNAVAILABLE');
  if (twelveHealth.successfulConnections !== 1) reasons.push('TWELVE_CONNECTION_COUNT_INVALID');
  if (twelveHealth.subscriptionsRequested !== 1 || twelveHealth.subscriptionsAccepted !== 1) reasons.push('TWELVE_SUBSCRIPTION_INVALID');
  if (twelveHealth.reconnects > 1) reasons.push('TWELVE_RECONNECT_BUDGET_EXCEEDED');
  let composition = null;
  if (saxoSnapshot && twelveHealth.symbols?.length) {
    composition = saxoSnapshot.marketDataRepresentation === 'BID_ASK_OHLC'
      ? composeSaxoBidAskIndependentQuote({ saxoSnapshot, quoteHealth: twelveHealth, now: now(), maxAgeMs: 30_000 })
      : composeSaxoClosedOhlcIndependentQuote({ saxoSnapshot, quoteHealth: twelveHealth, now: now(), maxAgeMs: 30_000 });
    if (composition.compositionState !== 'COMPOSABLE_OFFLINE') reasons.push(...composition.reasonCodes,
      ...(composition.compositionState === 'PROVIDER_EVIDENCE_COMPOSABLE_OFFLINE' ? ['CHAMPION_INCOMPATIBLE_BID_ASK'] : []));
  }
  const championCompositionReady = composition?.compositionVersion === CHAMPION_COMPOSITION_VERSION &&
    composition?.compositionState === 'COMPOSABLE_OFFLINE' &&
    composition?.marketDataRepresentation === 'DIRECT_OHLC_PLUS_INDEPENDENT_QUOTE' &&
    composition?.championCompatible === true && composition?.separation?.championBypass !== true;
  const passed = reasons.length === 0 && championCompositionReady;
  return { ...base, result: passed ? 'READONLY_COMMISSIONING_PASSED' : 'BLOCKED_EXTERNAL', sessions: 1,
    reasonCodes: [...new Set(reasons)], saxo: { environment: 'sim', subscriptions: 1, result: saxoSnapshot ? 'OBSERVED' : 'BLOCKED',
      completeness: saxoSnapshot?.candleCompleteness ?? 'UNVERIFIED', latestClosedCandleTimestamp: saxoSnapshot?.latestClosedCandleTimestamp ?? null,
      structure: saxoStructure },
    twelve: { connected: twelveHealth.connected, connections: twelveHealth.successfulConnections, subscriptions: twelveHealth.subscriptionsAccepted,
      reconnects: twelveHealth.reconnects, transportError: twelveHealth.lastError || null,
      transportDiagnostic: twelveHealth.lastTransportDiagnostic,
      eventTimestamp: composition?.quoteTimestamp ?? null, quoteAgeMs: composition?.quoteAgeMs ?? null },
    composition: composition ? { state: composition.compositionState, providerEvidenceValid: composition.providerEvidenceValid,
      marketDataRepresentation: composition.marketDataRepresentation, championCompatible: composition.championCompatible,
      valid: composition.valid, decisionImpact: composition.decisionImpact, prospectivePaperAuthorized: composition.prospectivePaperAuthorized,
      ordersExecuted: composition.ordersExecuted ?? 0, midpoint: composition.midpoint ?? null, selectedSide: composition.selectedSide ?? null,
      separation: composition.separation } : null,
    stoppedBeforeExternalAccess: false };
}
