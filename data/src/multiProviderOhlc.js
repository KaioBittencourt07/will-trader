export const MULTI_PROVIDER_OHLC_VERSION = 'multi-provider-ohlc-resilience-v1';

const canonical = (value) => String(value || '').trim().toUpperCase();
const validTime = (value) => Number.isFinite(Date.parse(value ?? ''));

function mappingFor(provider, symbol) {
  const mapped = provider.symbols?.[symbol] ?? provider.symbols?.[canonical(symbol)];
  return mapped ? String(mapped).trim().toUpperCase() : null;
}

function validate(snapshot, { providerId, providerSymbol, canonicalSymbol, timeframe }) {
  const reasons = [];
  if (!snapshot || typeof snapshot !== 'object') reasons.push('SNAPSHOT_MISSING');
  else {
    if (snapshot.valid !== true || snapshot.status !== 'OK') reasons.push('DATA_QUALITY_GATE_REJECTED');
    if (canonical(snapshot.asset) !== canonical(providerSymbol)) reasons.push('SYMBOL_MISMATCH');
    if (String(snapshot.timeframe || '') !== String(timeframe)) reasons.push('TIMEFRAME_MISMATCH');
    if (!Array.isArray(snapshot.candles) || !snapshot.candles.length) reasons.push('OHLC_MISSING');
    if (!snapshot.candles?.every((candle) => ['open', 'high', 'low', 'close'].every((key) => Number.isFinite(Number(candle?.[key]))))) reasons.push('OHLC_MALFORMED');
    if (!validTime(snapshot.quoteTimestamp ?? snapshot.timestamp) || !validTime(snapshot.latestCandleTimestamp ?? snapshot.candleTimestamp)) reasons.push('TIMESTAMP_INVALID');
    if (snapshot.freshnessPolicyVersion !== 'rest-quote-freshness-v1' || !snapshot.timestampOrigins) reasons.push('PROVENANCE_INSUFFICIENT');
  }
  return {
    valid: reasons.length === 0,
    reasonCodes: reasons,
    providerId,
    providerSymbol,
    canonicalSymbol
  };
}

function failureClass(error, readiness) {
  if (readiness?.state === 'COOLDOWN' || Number(error?.status) === 429 || /429|rate.?limit|cooldown/i.test(String(error?.message ?? error))) return 'RATE_LIMITED';
  if (readiness?.state === 'MISCONFIGURED' || /credential|api.?key|unauthori[sz]ed|forbidden/i.test(String(error?.message ?? error))) return 'MISCONFIGURED';
  return 'UNAVAILABLE';
}

export function createMultiProviderOhlc({ providers = [] } = {}) {
  const configured = providers.map((entry, index) => ({ priority: index, ...entry }));
  const inFlight = new Map();

  async function select(canonicalSymbol, timeframe = '1min', outputsize = 50, { telemetry } = {}) {
    const symbol = canonical(canonicalSymbol);
    const key = `${symbol}|${timeframe}|${outputsize}`;
    if (inFlight.has(key)) {
      if (telemetry && typeof telemetry === 'object') telemetry.deduplicated = Number(telemetry.deduplicated || 0) + 1;
      return inFlight.get(key);
    }
    const work = (async () => {
      const attempts = [];
      for (const entry of configured) {
        const providerId = String(entry.id || `provider-${entry.priority + 1}`);
        const providerSymbol = mappingFor(entry, symbol);
        if (!providerSymbol) {
          attempts.push({ providerId, state: 'MISCONFIGURED', reasonCodes: ['SYMBOL_MAPPING_MISSING'] });
          continue;
        }
        const readiness = entry.engine?.getProviderReadiness?.() ?? { state: 'READY' };
        if (readiness.state !== 'READY') {
          attempts.push({ providerId, state: readiness.state, reasonCodes: ['PROVIDER_NOT_READY'] });
          continue;
        }
        try {
          const snapshot = await entry.engine.getSnapshot(providerSymbol, timeframe, outputsize, { telemetry });
          const check = validate(snapshot, { providerId, providerSymbol, canonicalSymbol: symbol, timeframe });
          if (!check.valid) {
            attempts.push({ providerId, state: 'UNAVAILABLE', reasonCodes: check.reasonCodes });
            continue;
          }
          const fallbackReason = attempts.length ? attempts.at(-1).reasonCodes[0] : null;
          const selected = {
            ...snapshot,
            asset: symbol,
            providerAsset: providerSymbol,
            providerSelection: {
              version: MULTI_PROVIDER_OHLC_VERSION,
              selectedProvider: providerId,
              selectedPriority: entry.priority,
              fallbackUsed: entry.priority > 0,
              fallbackReason,
              attempts,
              provenancePreserved: true,
              mergedAcrossProviders: false
            }
          };
          if (telemetry && typeof telemetry === 'object') telemetry.providerSelection = selected.providerSelection;
          return selected;
        } catch (error) {
          attempts.push({ providerId, state: failureClass(error, entry.engine?.getProviderReadiness?.()), reasonCodes: [error?.code || failureClass(error, readiness)] });
        }
      }
      const error = new Error('All OHLC providers failed closed');
      error.code = 'ALL_PROVIDERS_UNAVAILABLE';
      error.providerSelection = { version: MULTI_PROVIDER_OHLC_VERSION, selectedProvider: null, attempts, provenancePreserved: true, mergedAcrossProviders: false };
      if (telemetry && typeof telemetry === 'object') telemetry.providerSelection = error.providerSelection;
      throw error;
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, work);
    return work;
  }

  return {
    getSnapshot: select,
    getStatus: () => ({
      version: MULTI_PROVIDER_OHLC_VERSION,
      providers: configured.map((entry) => ({ id: entry.id, priority: entry.priority, readiness: entry.engine?.getProviderReadiness?.() ?? { state: 'UNAVAILABLE' }, canonicalSymbols: Object.keys(entry.symbols || {}).map(canonical) })),
      inspectConsumesProvider: false
    })
  };
}
