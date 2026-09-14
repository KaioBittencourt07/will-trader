import 'dotenv/config';
import { observationFromTwelveExchangeRate, qualifyTwelveExchangeRateSeries } from './twelveExchangeRateTemporalQualification.js';

const BASE_URL = 'https://api.twelvedata.com';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function resolveApiKey() {
  const envKey = String(process.env.TWELVEDATA_API_KEY || '').trim();
  if (envKey) return { apiKey: envKey, source: 'ENV' };
  try {
    const module = await import('./localSecrets.js');
    const localKey = String(module?.localSecrets?.TWELVEDATA_API_KEY || '').trim();
    if (localKey && localKey !== 'COLOQUE_SUA_CHAVE_TWELVEDATA_AQUI') return { apiKey: localKey, source: 'LOCAL_SECRETS' };
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  }
  return { apiKey: null, source: null };
}

export async function runTwelveExchangeRateTemporalCommissioning({
  apiKey,
  apiKeySource = 'INJECTED',
  fetchImpl = fetch,
  now = () => Date.now(),
  wait = sleep,
  symbol = 'EUR/USD',
  observationsTarget = 4,
  intervalMs = 3_000,
  baseUrl = BASE_URL
} = {}) {
  const target = Math.min(6, Math.max(4, Number(observationsTarget) || 4));
  const delay = Math.min(10_000, Math.max(1_000, Number(intervalMs) || 3_000));
  const observations = [];
  const failures = [];
  let requestsMade = 0;

  for (let i = 0; i < target; i += 1) {
    try {
      requestsMade += 1;
      const response = await fetchImpl(`${baseUrl}/exchange_rate?symbol=${encodeURIComponent(symbol)}`, {
        method: 'GET',
        headers: { Authorization: `apikey ${apiKey}`, Accept: 'application/json' },
        cache: 'no-store'
      });
      if (!response.ok) {
        const error = new Error(`TWELVE_EXCHANGE_RATE_HTTP_${response.status}`);
        error.status = response.status;
        throw error;
      }
      const payload = await response.json();
      const receivedAt = new Date(now()).toISOString();
      observations.push(observationFromTwelveExchangeRate({ payload, receivedAt }));
    } catch (error) {
      failures.push(error?.message || 'TWELVE_EXCHANGE_RATE_UNKNOWN_ERROR');
      break;
    }
    if (i < target - 1) await wait(delay);
  }

  const checkedAt = now();
  const qualification = qualifyTwelveExchangeRateSeries({ observations, now: checkedAt });
  const authority = qualification.temporalAuthority;
  const approved = qualification.canEvaluateFrozenFreshness === true
    && authority?.authorityGate === 'PASS'
    && authority?.freshnessGate === 'PASS';

  return Object.freeze({
    status: approved ? 'APPROVED' : 'BLOCKED',
    semanticApproved: qualification.canEvaluateFrozenFreshness === true,
    temporalApproved: approved,
    symbol,
    endpoint: '/exchange_rate',
    apiKeySource,
    requestBudget: target,
    requestsMade,
    failures: Object.freeze(failures),
    qualification,
    temporalAuthority: authority,
    rawObservationsExposed: false,
    secretExposed: false,
    decisionImpact: 'NONE',
    prospectivePaperAuthorized: false,
    ordersExecuted: 0
  });
}

const directRun = process.argv[1] && new URL(import.meta.url).pathname.replace(/^\/(.:)/, '$1').replace(/\//g, process.platform === 'win32' ? '\\' : '/') === process.argv[1];
if (directRun) {
  const { apiKey, source } = await resolveApiKey();
  if (!apiKey) {
    console.error(JSON.stringify({ status: 'BLOCKED', reason: 'TWELVEDATA_API_KEY_NOT_AVAILABLE', expectedLocalFile: 'backend/src/localSecrets.js', requestsMade: 0, secretExposed: false }));
    process.exitCode = 2;
  } else {
    console.log(JSON.stringify(await runTwelveExchangeRateTemporalCommissioning({ apiKey, apiKeySource: source }), null, 2));
  }
}
