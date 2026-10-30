export const DATA_STATUS = Object.freeze({
  OK: 'OK',
  INVALID: 'INVALID',
  STALE: 'STALE'
});

export function normalizeMarketSnapshot(
  raw,
  {
    maxAgeMs = 90_000,
    now = Date.now()
  } = {}
) {
  const asset = String(raw?.asset ?? '').trim();
  const timeframe = String(raw?.timeframe ?? '').trim();
  const price = Number(raw?.price);
  const timestampMs = Date.parse(raw?.timestamp ?? '');

  const validShape = Boolean(
    asset &&
    timeframe &&
    Number.isFinite(price) &&
    price > 0 &&
    Number.isFinite(timestampMs)
  );

  if (!validShape) {
    return {
      status: DATA_STATUS.INVALID,
      valid: false,
      reason: 'INVALID_MARKET_SNAPSHOT'
    };
  }

  const ageMs = now - timestampMs;

  if (ageMs < -60_000) {
    return {
      status: DATA_STATUS.INVALID,
      valid: false,
      reason: 'FUTURE_MARKET_DATA',
      asset,
      timeframe,
      price,
      timestamp: new Date(timestampMs).toISOString()
    };
  }

  if (ageMs > maxAgeMs) {
    return {
      ...raw,
      status: DATA_STATUS.STALE,
      valid: false,
      reason: 'STALE_MARKET_DATA',
      asset,
      timeframe,
      price,
      timestamp: new Date(timestampMs).toISOString(),
      ageMs
    };
  }

  return {
    ...raw,
    status: DATA_STATUS.OK,
    valid: true,
    asset,
    timeframe,
    price,
    timestamp: new Date(timestampMs).toISOString(),
    ageMs
  };
}

// Re-evaluates only the explicitly versioned freshness contract. It never
// substitutes cache time, receive time, candle time or WS time for the REST
// quote timestamp that governed the original gate.
export function refreshMarketSnapshotFreshness(snapshot, { now = Date.now(), cacheStoredAt = null } = {}) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const cacheAgeMs = Number.isFinite(Number(cacheStoredAt)) ? now - Number(cacheStoredAt) : null;
  if (snapshot.freshnessPolicyVersion !== 'rest-quote-freshness-v1') {
    return snapshot;
  }
  return {
    ...normalizeMarketSnapshot(snapshot, {
      maxAgeMs: Number(snapshot.freshnessMaxAgeMs),
      now
    }),
    cacheAgeMs,
    quoteAgeMs: now - Date.parse(snapshot.quoteTimestamp),
    candleAgeMs: now - Date.parse(snapshot.candleTimestamp),
    providerTiming: {
      ...snapshot.providerTiming,
      evaluatedAt: new Date(now).toISOString()
    }
  };
}
