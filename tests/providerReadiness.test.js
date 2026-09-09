import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarketDataEngine } from '../data/src/marketDataEngine.js';
import { createProviderEfficiencyTelemetry } from '../data/src/providerEfficiency.js';
import { composeWsFreshnessRestOhlc } from '../data/src/wsRestComposition.js';

function limited({ retryAfterMs, retryAfterAt, rateLimitResetAt } = {}) {
  const error = new Error('Twelve Data quote HTTP 429');
  error.status = 429;
  if (retryAfterMs !== undefined) error.retryAfterMs = retryAfterMs;
  if (retryAfterAt) error.retryAfterAt = retryAfterAt;
  if (rateLimitResetAt) error.rateLimitResetAt = rateLimitResetAt;
  return error;
}

test('429 opens deterministic default cooldown, disables generic retries and blocks new REST work', async () => {
  let calls = 0;
  let clock = 1_000;
  const firstTelemetry = createProviderEfficiencyTelemetry('first');
  const blockedTelemetry = createProviderEfficiencyTelemetry('blocked');
  const engine = createMarketDataEngine({
    provider: { getSnapshot: async () => { calls += 1; throw limited(); } },
    now: () => clock, minRequestIntervalMs: 0, maxRetries: 2, rateLimitCooldownMs: 60_000
  });
  await assert.rejects(() => engine.getSnapshot('EUR/USD', '1min', 50, { telemetry: firstTelemetry }), /429/);
  await assert.rejects(() => engine.getSnapshot('GBP/USD', '1min', 50, { telemetry: blockedTelemetry }), (error) => error.code === 'PROVIDER_COOLDOWN');
  assert.equal(calls, 1);
  assert.equal(firstTelemetry.rateLimitEvents, 1);
  assert.equal(blockedTelemetry.blockedByCooldown, 1);
  assert.equal(engine.getMetrics().retries, 0);
  assert.equal(engine.getProviderReadiness().state, 'COOLDOWN');
  assert.equal(engine.getProviderReadiness().cooldownRemainingMs, 60_000);
  assert.equal(engine.getProviderReadiness().lastRateLimitEvidence.cooldownSource, 'LOCAL_DEFAULT');
});

test('Retry-After controls cooldown and one real success restores healthy state', async () => {
  let calls = 0;
  let clock = 10_000;
  const engine = createMarketDataEngine({
    provider: { getSnapshot: async () => { calls += 1; if (calls === 1) throw limited({ retryAfterMs: 5_000 }); return { price: 1.1 }; } },
    now: () => clock, minRequestIntervalMs: 0
  });
  await assert.rejects(() => engine.getSnapshot('EUR/USD'), /429/);
  assert.equal(engine.getProviderReadiness().cooldownRemainingMs, 5_000);
  clock += 5_000;
  assert.deepEqual(await engine.getSnapshot('EUR/USD'), { price: 1.1 });
  assert.equal(engine.getProviderReadiness().state, 'READY');
  assert.equal(engine.getMetrics().providerState, 'HEALTHY');
});

test('reset timestamp is honored and capped by the configured safety maximum', async () => {
  let clock = 100_000;
  const engine = createMarketDataEngine({
    provider: { getSnapshot: async () => { throw limited({ rateLimitResetAt: new Date(clock + 50_000).toISOString() }); } },
    now: () => clock, minRequestIntervalMs: 0, maxRateLimitCooldownMs: 20_000
  });
  await assert.rejects(() => engine.getSnapshot('EUR/USD'), /429/);
  assert.equal(engine.getProviderReadiness().cooldownRemainingMs, 20_000);
  assert.equal(engine.getProviderReadiness().lastRateLimitEvidence.cooldownSource, 'RESET_HEADER');
});

test('readiness inspection is local and consumes no provider request', () => {
  let calls = 0;
  const engine = createMarketDataEngine({ provider: { getSnapshot: async () => { calls += 1; } } });
  const status = engine.getProviderReadiness();
  assert.equal(status.state, 'READY');
  assert.equal(status.inspectConsumesProvider, false);
  assert.equal(calls, 0);
});

test('network and credential failures classify readiness without manufacturing data', async () => {
  const offline = createMarketDataEngine({ provider: { getSnapshot: async () => { throw new Error('network unreachable'); } }, minRequestIntervalMs: 0, maxRetries: 0 });
  await assert.rejects(() => offline.getSnapshot('EUR/USD'));
  assert.equal(offline.getProviderReadiness().state, 'UNAVAILABLE');
  const badKey = createMarketDataEngine({ provider: { getSnapshot: async () => { throw new Error('API_KEY credential unauthorized'); } }, minRequestIntervalMs: 0, maxRetries: 0 });
  await assert.rejects(() => badKey.getSnapshot('EUR/USD'));
  assert.equal(badKey.getProviderReadiness().state, 'MISCONFIGURED');
});

test('fresh WS plus rate-limited REST remains UNKNOWN and has no decision impact', () => {
  const now = Date.parse('2026-09-08T12:00:00.000Z');
  const value = composeWsFreshnessRestOhlc({
    restSnapshot: null, canonicalSymbol: 'EUR/USD', timeframe: '1min', now,
    wsHealth: { mode: 'SHADOW_OBSERVABILITY', connected: true, subscriptionsAccepted: 1, subscriptionsRejected: 0, staleAfterMs: 30_000,
      symbols: [{ symbol: 'EUR/USD', price: 1.17, eventTimestamp: now - 1_000, receivedAt: new Date(now - 500).toISOString() }] }
  });
  assert.equal(value.compositionState, 'UNKNOWN');
  assert.ok(value.reasonCodes.includes('REST_SNAPSHOT_MISSING'));
  assert.equal(value.decisionImpact, 'NONE');
  assert.equal(value.composableDoesNotAuthorizeDecision, true);
});
