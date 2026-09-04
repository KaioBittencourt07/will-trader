/**
 * Bounded, PAPER-only internal orchestration. This module only observes local
 * endpoints; it cannot create an order, click a broker, or manufacture data.
 */
export async function runPaperMonitorCycle({
  baseUrl,
  cycleId,
  timeout,
  asset = 'EUR/USD',
  timeframe = '1min',
  fetchImpl = fetch,
  abortSignalFactory = AbortSignal.timeout
} = {}) {
  if (!timeout?.valid) {
    return { ok: false, status: timeout?.status ?? 'MONITOR_TIMEOUT_CONFIG_INVALID', scanned: 0, recommendation: null };
  }
  const efficiency = {
    version: 'provider-efficiency-v1', scope: 'paper-monitor-cycle', externalRequests: 0,
    cacheHits: 0, cacheMisses: 0, deduplicated: 0, limiterWaitMs: 0,
    externalLatencyMs: 0, creditsEstimated: 0, creditsEstimatedIsOfficial: false
  };
  const addEfficiency = (value) => {
    for (const key of ['externalRequests', 'cacheHits', 'cacheMisses', 'deduplicated', 'limiterWaitMs', 'externalLatencyMs', 'creditsEstimated']) {
      const amount = Number(value?.[key]);
      if (Number.isFinite(amount) && amount >= 0) efficiency[key] += amount;
    }
  };
  const request = async (url) => {
    const response = await fetchImpl(url, { signal: abortSignalFactory(timeout.timeoutMs) });
    return { response, body: await response.json() };
  };
  const diagnosticUrl = new URL('/api/market/diagnostic', baseUrl);
  diagnosticUrl.searchParams.set('asset', asset);
  diagnosticUrl.searchParams.set('timeframe', timeframe);
  const diagnostic = await request(diagnosticUrl);
  addEfficiency(diagnostic.body?.providerEfficiency);
  if (!diagnostic.response.ok || diagnostic.body?.diagnostic?.status !== 'HEALTHY') {
    return {
      ok: false,
      status: `MARKET_DATA_GATE_${diagnostic.body?.diagnostic?.status ?? 'UNVERIFIED'}`,
      scanned: 0,
      recommendation: null,
      providerEfficiency: efficiency
    };
  }
  const opportunitiesUrl = new URL('/api/opportunities', baseUrl);
  opportunitiesUrl.searchParams.set('limit', '1');
  opportunitiesUrl.searchParams.set('timeframe', timeframe);
  opportunitiesUrl.searchParams.set('monitorCycleId', cycleId);
  const opportunities = await request(opportunitiesUrl);
  const body = opportunities.body;
  addEfficiency(body?.providerEfficiency);
  return {
    ok: opportunities.response.ok && body?.ok === true && !body?.status && !(body?.unavailable?.length),
    status: body?.status ?? null,
    scanned: body?.scanned ?? 0,
    recommendation: body?.recommendation ? body.recommendation.asset : null,
    providerEfficiency: efficiency
  };
}

