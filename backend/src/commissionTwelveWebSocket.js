import 'dotenv/config';
import { createTwelveWebSocketFeed } from '../../data/src/providers/twelveWebSocketFeed.js';

async function resolveApiKey() {
  const envKey = String(process.env.TWELVEDATA_API_KEY || '').trim();
  if (envKey) return { apiKey: envKey, source: 'ENV' };

  try {
    const module = await import('./localSecrets.js');
    const localKey = String(module?.localSecrets?.TWELVEDATA_API_KEY || '').trim();
    if (localKey && localKey !== 'COLOQUE_SUA_CHAVE_TWELVEDATA_AQUI') {
      return { apiKey: localKey, source: 'LOCAL_SECRETS' };
    }
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  }

  return { apiKey: null, source: null };
}

const durationMs = Math.min(60_000, Math.max(5_000, Number(process.env.WILL_TWELVE_WS_COMMISSION_MS || 30_000)));
const symbol = String(process.env.WILL_TWELVE_WS_SYMBOLS || 'EUR/USD').split(',')[0].trim().toUpperCase();
const { apiKey, source: apiKeySource } = await resolveApiKey();

if (!apiKey) {
  console.error(JSON.stringify({
    status: 'BLOCKED',
    reason: 'TWELVEDATA_API_KEY_NOT_AVAILABLE',
    expectedLocalFile: 'backend/src/localSecrets.js',
    secretExposed: false,
    restRequestsMade: 0,
    wsConnectionsMade: 0
  }));
  process.exitCode = 2;
} else {
  const feed = createTwelveWebSocketFeed({
    enabled: true,
    apiKey,
    symbols: [symbol]
  });
  feed.start();
  setTimeout(() => {
    const health = feed.health();
    feed.stop();
    console.log(JSON.stringify({
      status: health.successfulConnections > 0 && health.subscriptionsAccepted > 0 && health.ticksAccepted > 0
        ? 'APPROVED'
        : 'BLOCKED',
      symbol,
      apiKeySource,
      health,
      secretExposed: false
    }, null, 2));
  }, durationMs);
}
