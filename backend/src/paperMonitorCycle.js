/**
 * Bounded, PAPER-only internal orchestration. This module only observes local
 * endpoints; it cannot create an order, click a broker, or manufacture data.
 */
export async function runPaperMonitorCycle({
  baseUrl,
  cycleId,
  capability,
  timeout,
  asset = 'EUR/USD',
  assetClass = 'FX_CRYPTO',
  limit = 4,
  multiAsset = false,
  timeframe = '1min',
  fetchImpl = fetch,
  abortSignalFactory = AbortSignal.timeout
} = {}) {
  if (!timeout?.valid) {
    return { ok: false, status: timeout?.status ?? 'MONITOR_TIMEOUT_CONFIG_INVALID', scanned: 0, recommendation: null };
  }
  if (capability !== undefined) {
    let target;
    try { target=new URL(baseUrl); } catch { return {ok:false,status:'EVIDENCE_TARGET_INVALID'}; }
    if (typeof capability !== 'string' || !/^[a-f0-9]{64}$/.test(capability) ||
      !['127.0.0.1','localhost','[::1]'].includes(target.hostname) || !['http:','https:'].includes(target.protocol) || target.username || target.password) {
      return {ok:false,status:'EVIDENCE_TARGET_INVALID'};
    }
  }

  const boundedLimit = Math.min(4, Math.max(1, Number(limit) || 1));
  const efficiency = {
    version: 'provider-efficiency-v1', scope: 'paper-monitor-cycle', externalRequests: 0,
    cacheHits: 0, cacheMisses: 0, deduplicated: 0, blockedByCooldown: 0, rateLimitEvents: 0, limiterWaitMs: 0,
    externalLatencyMs: 0, creditsEstimated: 0, creditsEstimatedIsOfficial: false
  };
  const addEfficiency = (value) => {
    for (const key of ['externalRequests', 'cacheHits', 'cacheMisses', 'deduplicated', 'blockedByCooldown', 'rateLimitEvents', 'limiterWaitMs', 'externalLatencyMs', 'creditsEstimated']) {
      const amount = Number(value?.[key]);
      if (Number.isFinite(amount) && amount >= 0) efficiency[key] += amount;
    }
  };
  const request = async (url, evidence = false) => {
    const options={ signal: abortSignalFactory(timeout.timeoutMs) };
    if (evidence && capability !== undefined) {
      options.headers={'X-WILL-CYCLE-EVIDENCE-CAPABILITY':capability};
      options.redirect='error';
    }
    const response = await fetchImpl(url, options);
    return { response, body: await response.json() };
  };

  // Legacy single-asset mode keeps the explicit diagnostic pre-gate for
  // backward compatibility and targeted troubleshooting.
  if (!multiAsset) {
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
  }

  // Multiasset PAPER mode delegates admission to /api/opportunities, which
  // already applies per-asset freshness, market-admission, canonical closed-
  // candle proof and study dedup gates. No broker execution capability exists.
  const opportunitiesUrl = new URL('/api/opportunities', baseUrl);
  opportunitiesUrl.searchParams.set('limit', String(multiAsset ? boundedLimit : 1));
  opportunitiesUrl.searchParams.set('timeframe', timeframe);
  opportunitiesUrl.searchParams.set('monitorCycleId', cycleId);
  if (multiAsset) opportunitiesUrl.searchParams.set('assetClass', assetClass);

  const opportunities = await request(opportunitiesUrl, true);
  const body = opportunities.body;
  addEfficiency(body?.providerEfficiency);
  return {
    ok: opportunities.response.ok && body?.ok === true && !body?.status,
    status: body?.status ?? null,
    scanned: body?.scanned ?? 0,
    recommendation: body?.recommendation ? body.recommendation.asset : null,
    roundState: body?.roundState?.state ?? null,
    coverage: Array.isArray(body?.coverage?.assets) ? [...body.coverage.assets] : [],
    unavailable: Array.isArray(body?.unavailable) ? body.unavailable.length : 0,
    providerEfficiency: efficiency
  };
}
