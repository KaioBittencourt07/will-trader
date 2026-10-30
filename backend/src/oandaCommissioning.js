import { createMarketDataEngine } from '../../data/src/marketDataEngine.js';
import { createProviderEfficiencyTelemetry, providerEfficiencySnapshot } from '../../data/src/providerEfficiency.js';
import { createOandaReadOnlyProvider, OANDA_LIVE_ADAPTER_VERSION } from '../../data/src/providers/oandaProvider.js';

export async function runOandaCommissioning({ env = process.env, fetchImpl = fetch, now = () => Date.now() } = {}) {
  const provider = createOandaReadOnlyProvider({ enabled: env.WILL_OANDA_ENABLED === 'true', token: env.OANDA_TOKEN, accountId: env.OANDA_ACCOUNT_ID, environment: env.OANDA_ENVIRONMENT || 'practice', fetchImpl, now });
  const engine = createMarketDataEngine({ provider, now, minRequestIntervalMs: 0, maxRetries: 0, rateLimitCooldownMs: 60_000 });
  const telemetry = createProviderEfficiencyTelemetry('oanda-readonly-one-shot');
  const configuration = provider.configuration();
  try {
    const snapshot = await engine.getSnapshot('EUR_USD', '1min', 50, { telemetry });
    return {
      result: snapshot.valid ? 'LIVE_QUALIFICATION_OBSERVED' : 'BLOCKED_DATA_QUALITY', provider: 'oanda-rest-v20', adapterVersion: OANDA_LIVE_ADAPTER_VERSION,
      canonicalSymbol: 'EUR/USD', providerSymbol: 'EUR_USD', timeframe: '1min', granularity: 'M1', configuration,
      quoteTimestamp: snapshot.quoteTimestamp, quoteAgeMs: snapshot.quoteAgeMs, latestClosedCandleTimestamp: snapshot.latestClosedCandleTimestamp,
      candleAgeMs: snapshot.candleAgeMs, completeness: snapshot.candleCompleteness, ohlcAdequacy: snapshot.valid ? 'VALID' : 'REJECTED',
      freshnessPolicyVersion: snapshot.freshnessPolicyVersion, providerReceivedAt: snapshot.providerReceivedAt, timestampOrigins: snapshot.timestampOrigins,
      authoritativeStatus: snapshot.status, authoritativeReason: snapshot.reason, authoritativeValid: snapshot.valid,
      requestBudget: 2, providerEfficiency: providerEfficiencySnapshot(telemetry), readiness: engine.getProviderReadiness(), secretExposed: false
    };
  } catch (error) {
    return {
      result: 'BLOCKED', reason: error.code || provider.classifyFailure(error), httpStatus: Number(error.status) || null,
      provider: 'oanda-rest-v20', adapterVersion: OANDA_LIVE_ADAPTER_VERSION, canonicalSymbol: 'EUR/USD', providerSymbol: 'EUR_USD', timeframe: '1min', granularity: 'M1',
      configuration, requestBudget: 2, providerEfficiency: providerEfficiencySnapshot(telemetry), readiness: engine.getProviderReadiness(), secretExposed: false
    };
  }
}
