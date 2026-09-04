export const TWELVE_DATA_DIAGNOSTIC_VERSION = 'twelve-data-diagnostic-v1';

function freshnessOf(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  return {
    freshnessBasis: snapshot.freshnessBasis ?? null,
    freshnessPolicyVersion: snapshot.freshnessPolicyVersion ?? null,
    quoteTimestamp: snapshot.quoteTimestamp ?? null,
    quoteAgeMs: Number.isFinite(Number(snapshot.quoteAgeMs ?? snapshot.ageMs)) ? Number(snapshot.quoteAgeMs ?? snapshot.ageMs) : null,
    latestCandleTimestamp: snapshot.latestCandleTimestamp ?? snapshot.candleTimestamp ?? null,
    latestClosedCandleTimestamp: snapshot.latestClosedCandleTimestamp ?? null,
    candleAgeMs: Number.isFinite(Number(snapshot.candleAgeMs)) ? Number(snapshot.candleAgeMs) : null,
    candleCompleteness: snapshot.candleCompleteness ?? null,
    providerReceivedAt: snapshot.providerReceivedAt ?? null,
    providerLatencyMs: snapshot.providerTiming?.providerLatencyMs ?? null,
    cacheAgeMs: Number.isFinite(Number(snapshot.cacheAgeMs)) ? Number(snapshot.cacheAgeMs) : null,
    source: snapshot.source ?? null
  };
}

function messageOf(error) {
  return String(error?.message ?? error ?? 'unknown error');
}

/** Pure, conservative classification. It never turns an unknown failure into
 * a usable market-data signal. */
export function classifyTwelveDataFailure(error) {
  const message = messageOf(error);
  const status = Number(error?.status);
  if (/TWELVEDATA_API_KEY.*n.o configurada|credential|api.?key|unauthori[sz]ed|forbidden/i.test(message) || status === 401 || status === 403) {
    return 'CREDENTIAL_ERROR';
  }
  if (status === 429 || /\b429\b|rate.?limit|too many requests/i.test(message)) return 'RATE_LIMITED';
  if (/EACCES|network blocked|network error|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network unreachable/i.test(message)) return 'NETWORK_BLOCKED';
  if (/snapshot incompleto|timestamp v.lido|invalid json|resposta inv.lida|malformed|Twelve Data (quote|time_series):/i.test(message)) return 'INVALID_RESPONSE';
  if (/stale|DATA_STALE/i.test(message)) return 'STALE_DATA';
  return 'UNKNOWN_ERROR';
}

// Match the opportunity request shape so the monitor diagnostic warms the exact cache entry.
export async function diagnoseTwelveData({ engine, asset = 'EUR/USD', timeframe = '1min', outputsize = 50, telemetry, now = () => new Date().toISOString(), composeShadow } = {}) {
  const checkedAt = typeof now === 'function' ? now() : now;
  if (!engine || typeof engine.getSnapshot !== 'function') {
    const compositionShadow = typeof composeShadow === 'function' ? composeShadow(null) : undefined;
    return { ok: false, status: 'INVALID_RESPONSE', checkedAt, version: TWELVE_DATA_DIAGNOSTIC_VERSION, detail: 'MARKET_ENGINE_UNAVAILABLE', ...(compositionShadow ? { compositionShadow } : {}) };
  }
  try {
    const snapshot = telemetry
      ? await engine.getSnapshot(asset, timeframe, outputsize, { telemetry })
      : await engine.getSnapshot(asset, timeframe, outputsize);
    const compositionShadow = typeof composeShadow === 'function' ? composeShadow(snapshot) : undefined;
    if (!snapshot?.valid) {
      return { ok: false, status: 'STALE_DATA', checkedAt, version: TWELVE_DATA_DIAGNOSTIC_VERSION, detail: snapshot?.status ?? 'SNAPSHOT_INVALID', freshness: freshnessOf(snapshot), ...(compositionShadow ? { compositionShadow } : {}) };
    }
    return { ok: true, status: 'HEALTHY', checkedAt, version: TWELVE_DATA_DIAGNOSTIC_VERSION, asset: String(asset).toUpperCase(), timeframe, freshness: freshnessOf(snapshot), ...(compositionShadow ? { compositionShadow } : {}) };
  } catch (error) {
    const compositionShadow = typeof composeShadow === 'function' ? composeShadow(null) : undefined;
    return { ok: false, status: classifyTwelveDataFailure(error), checkedAt, version: TWELVE_DATA_DIAGNOSTIC_VERSION, detail: messageOf(error).slice(0, 500), ...(compositionShadow ? { compositionShadow } : {}) };
  }
}

