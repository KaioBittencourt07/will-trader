import { createMarketProvider } from '../provider.js';

export function createHttpMarketProvider({ url, buildUrl, fetchImpl = fetch, maxAgeMs = 10_000 } = {}) {
  if (!url && typeof buildUrl !== 'function') throw new Error('url ou buildUrl é obrigatório.');
  return createMarketProvider({
    maxAgeMs,
    fetchSnapshot: async (asset, timeframe) => {
      const endpoint = typeof buildUrl === 'function' ? buildUrl(asset, timeframe) : url;
      const response = await fetchImpl(endpoint, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Market provider HTTP ${response.status}`);
      const payload = await response.json();
      return payload.market ?? payload;
    }
  });
}
