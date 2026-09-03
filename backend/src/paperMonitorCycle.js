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
  const request = async (url) => {
    const response = await fetchImpl(url, { signal: abortSignalFactory(timeout.timeoutMs) });
    return { response, body: await response.json() };
  };
  const diagnosticUrl = new URL('/api/market/diagnostic', baseUrl);
  diagnosticUrl.searchParams.set('asset', asset);
  diagnosticUrl.searchParams.set('timeframe', timeframe);
  const diagnostic = await request(diagnosticUrl);
  if (!diagnostic.response.ok || diagnostic.body?.diagnostic?.status !== 'HEALTHY') {
    return {
      ok: false,
      status: `MARKET_DATA_GATE_${diagnostic.body?.diagnostic?.status ?? 'UNVERIFIED'}`,
      scanned: 0,
      recommendation: null
    };
  }
  const opportunitiesUrl = new URL('/api/opportunities', baseUrl);
  opportunitiesUrl.searchParams.set('limit', '1');
  opportunitiesUrl.searchParams.set('timeframe', timeframe);
  opportunitiesUrl.searchParams.set('monitorCycleId', cycleId);
  const opportunities = await request(opportunitiesUrl);
  const body = opportunities.body;
  return {
    ok: opportunities.response.ok && body?.ok === true && !body?.status && !(body?.unavailable?.length),
    status: body?.status ?? null,
    scanned: body?.scanned ?? 0,
    recommendation: body?.recommendation ? body.recommendation.asset : null
  };
}

