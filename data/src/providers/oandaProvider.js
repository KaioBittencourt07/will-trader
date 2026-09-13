import { addProviderEfficiency } from '../providerEfficiency.js';
import { transformOandaOffline, classifyOandaFailure } from './oandaQualification.js';

export const OANDA_LIVE_ADAPTER_VERSION = 'oanda-rest-v20-readonly-adapter-v1';
const URLS = Object.freeze({ practice: 'https://api-fxpractice.oanda.com', live: 'https://api-fxtrade.oanda.com' });

function configError(reason) {
  const error = new Error(`OANDA configuration invalid: ${reason}`);
  error.code = 'OANDA_MISCONFIGURED';
  error.status = 401;
  return error;
}

function httpError(response) {
  const error = new Error(`OANDA REST HTTP ${response.status}`);
  error.status = response.status;
  const raw = response.headers?.get?.('retry-after');
  if (raw !== null && raw !== undefined && Number.isFinite(Number(raw))) error.retryAfterMs = Math.max(0, Number(raw) * 1_000);
  error.rateLimitEvidence = { httpStatus: response.status, retryAfterProvided: raw !== null && raw !== undefined, resetProvided: false };
  return error;
}

export function createOandaReadOnlyProvider({ enabled = false, token, accountId, environment = 'practice', fetchImpl = fetch, now = () => Date.now(), timeoutMs = 10_000 } = {}) {
  const baseUrl = URLS[environment];
  const configured = enabled === true && Boolean(token) && Boolean(accountId) && Boolean(baseUrl);
  async function request(url, telemetry, budget) {
    if (budget.used >= 2) { const error = new Error('OANDA request budget exceeded'); error.code = 'OANDA_REQUEST_BUDGET_EXCEEDED'; throw error; }
    budget.used += 1;
    const started = now();
    let response;
    try {
      response = await fetchImpl(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (cause) {
      const error = new Error(`OANDA network error: ${cause?.name === 'TimeoutError' ? 'timeout' : 'unavailable'}`);
      error.code = 'OANDA_NETWORK_ERROR';
      throw error;
    } finally {
      addProviderEfficiency(telemetry, { externalRequests: 1, externalLatencyMs: Math.max(0, now() - started) });
    }
    if (!response?.ok) throw httpError(response);
    return response.json();
  }
  return {
    id: 'oanda-rest-v20',
    version: OANDA_LIVE_ADAPTER_VERSION,
    configuration: () => ({ enabled, configured, environment: baseUrl ? environment : 'INVALID', tokenConfigured: Boolean(token), accountConfigured: Boolean(accountId), secretExposed: false }),
    async getSnapshot(asset, timeframe = '1min', outputsize = 50, { telemetry } = {}) {
      if (!configured) throw configError(!enabled ? 'DISABLED' : !token ? 'TOKEN_MISSING' : !accountId ? 'ACCOUNT_ID_MISSING' : 'ENVIRONMENT_INVALID');
      if (asset !== 'EUR_USD' || timeframe !== '1min') throw configError('UNQUALIFIED_MAPPING');
      const budget = { used: 0 };
      const count = Math.min(5000, Math.max(12, Number(outputsize) || 50));
      const [pricingResponse, candlesResponse] = await Promise.all([
        request(`${baseUrl}/v3/accounts/${encodeURIComponent(accountId)}/pricing?instruments=EUR_USD`, telemetry, budget),
        request(`${baseUrl}/v3/instruments/EUR_USD/candles?price=M&granularity=M1&count=${count}`, telemetry, budget)
      ]);
      return transformOandaOffline({ candlesResponse, pricingResponse, providerSymbol: asset, timeframe, granularity: 'M1', receivedAt: new Date(now()).toISOString(), maxAgeMs: 30_000 });
    },
    classifyFailure: classifyOandaFailure
  };
}
