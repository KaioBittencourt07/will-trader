export function createMarketSnapshot(input) {
  return {
    asset: input?.asset ?? null,
    timestamp: input?.timestamp ?? null,
    price: Number(input?.price),
    timeframe: input?.timeframe ?? null,
    trend: Number(input?.trend),
    momentum: Number(input?.momentum),
    structure: Number(input?.structure),
    volatility: Number(input?.volatility),
    confirmations: Number(input?.confirmations ?? 0),
    source: input?.source ?? 'unknown'
  };
}

export function validateSnapshot(snapshot, maxAgeMs = 120_000) {
  const errors = [];
  if (!snapshot.asset) errors.push('asset');
  if (!snapshot.timeframe) errors.push('timeframe');
  if (!snapshot.timestamp || !Number.isFinite(Date.parse(snapshot.timestamp))) errors.push('timestamp');
  if (!Number.isFinite(snapshot.price) || snapshot.price <= 0) errors.push('price');
  if (![snapshot.trend, snapshot.momentum, snapshot.structure, snapshot.volatility].every(Number.isFinite)) errors.push('market factors');

  if (snapshot.timestamp) {
    const age = Date.now() - Date.parse(snapshot.timestamp);
    if (age < -60_000) errors.push('future timestamp');
    if (age > maxAgeMs) errors.push('stale data');
  }

  return { valid: errors.length === 0, errors };
}
