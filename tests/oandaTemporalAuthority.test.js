import assert from 'node:assert/strict';
import test from 'node:test';
import { createOandaTemporalAuthorityProvider, observationFromOandaPricing } from '../backend/src/oandaTemporalAuthority.js';

const NOW = Date.parse('2026-09-14T12:00:20.000Z');
const pricing = { prices: [{ instrument: 'EUR_USD', time: '2026-09-14T12:00:15.000Z', closeoutBid: '1.1000', closeoutAsk: '1.1002' }] };

test('extracts documented Oanda pricing event-time field but does not self-approve runtime semantics', () => {
  const observation = observationFromOandaPricing({ pricingResponse: pricing, receivedAt: '2026-09-14T12:00:19.000Z' });
  assert.equal(observation.provider, 'oanda-pricing-v20');
  assert.equal(observation.timestampAuthority, 'OANDA_PRICING_PROVIDER_EVENT_TIME');
  assert.equal(observation.provenanceVerified, true);
  assert.equal(observation.perEventSemanticsVerified, false);
  assert.equal(observation.decisionImpact, 'NONE');
});

test('provider remains blocked until an empirical qualification layer marks per-event semantics verified', async () => {
  const provider = createOandaTemporalAuthorityProvider({
    observePricing: async () => ({ pricingResponse: pricing, receivedAt: '2026-09-14T12:00:19.000Z' })
  });
  const authority = await provider.getAuthority('EUR/USD', { now: NOW });
  assert.equal(authority.authorityGate, 'FAIL');
  assert.equal(authority.freshnessGate, 'UNVERIFIED');
  assert.ok(authority.reasons.includes('TEMPORAL_PER_EVENT_SEMANTICS_NOT_VERIFIED'));
  assert.equal(authority.ordersExecuted, 0);
});

test('missing provider event time fails before qualification', () => {
  assert.throws(() => observationFromOandaPricing({ pricingResponse: { prices: [{ instrument: 'EUR_USD' }] }, receivedAt: '2026-09-14T12:00:19.000Z' }), /OANDA_TEMPORAL_EVENT_TIME_MISSING/);
});
