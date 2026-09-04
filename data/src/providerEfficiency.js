export const PROVIDER_EFFICIENCY_VERSION = 'provider-efficiency-v1';

export function createProviderEfficiencyTelemetry(scope = 'request') {
  return {
    version: PROVIDER_EFFICIENCY_VERSION,
    scope,
    externalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    deduplicated: 0,
    limiterWaitMs: 0,
    externalLatencyMs: 0,
    creditsEstimated: 0,
    creditsEstimatedIsOfficial: false
  };
}

export function addProviderEfficiency(target, values = {}) {
  if (!target || typeof target !== 'object') return;
  for (const key of ['externalRequests', 'cacheHits', 'cacheMisses', 'deduplicated', 'limiterWaitMs', 'externalLatencyMs', 'creditsEstimated']) {
    const value = Number(values[key]);
    if (Number.isFinite(value) && value >= 0) target[key] = Number(target[key] || 0) + value;
  }
}

export function providerEfficiencySnapshot(telemetry) {
  const snapshot = createProviderEfficiencyTelemetry(telemetry?.scope);
  addProviderEfficiency(snapshot, telemetry);
  return snapshot;
}
