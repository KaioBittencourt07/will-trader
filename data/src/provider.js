import { normalizeMarketSnapshot } from './marketAdapter.js';

export function createMarketProvider({ fetchSnapshot, maxAgeMs = 10_000 } = {}) {
  if (typeof fetchSnapshot !== 'function') throw new Error('fetchSnapshot é obrigatório.');
  return {
    async getSnapshot(asset, timeframe) {
      const raw = await fetchSnapshot(asset, timeframe);
      return normalizeMarketSnapshot({ ...raw, asset: raw?.asset ?? asset, timeframe: raw?.timeframe ?? timeframe }, { maxAgeMs });
    }
  };
}

export function createManualProvider(snapshot, options = {}) {
  return createMarketProvider({ fetchSnapshot: async () => snapshot, ...options });
}
