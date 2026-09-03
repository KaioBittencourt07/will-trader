import 'dotenv/config';
import { createTwelveWebSocketFeed } from '../../data/src/providers/twelveWebSocketFeed.js';

const durationMs = Math.min(60_000, Math.max(5_000, Number(process.env.WILL_TWELVE_WS_COMMISSION_MS || 30_000)));
const symbol = String(process.env.WILL_TWELVE_WS_SYMBOLS || 'EUR/USD').split(',')[0].trim().toUpperCase();

if (!process.env.TWELVEDATA_API_KEY) {
  console.error(JSON.stringify({
    status: 'BLOCKED',
    reason: 'TWELVEDATA_API_KEY_NOT_AVAILABLE',
    secretExposed: false,
    restRequestsMade: 0,
    wsConnectionsMade: 0
  }));
  process.exitCode = 2;
} else {
  const feed = createTwelveWebSocketFeed({
    enabled: true,
    apiKey: process.env.TWELVEDATA_API_KEY,
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
      health,
      secretExposed: false
    }, null, 2));
  }, durationMs);
}
