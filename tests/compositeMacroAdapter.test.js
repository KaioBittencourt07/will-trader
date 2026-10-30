import assert from 'node:assert/strict';
import test from 'node:test';
import { createCompositeMacroAdapter, COMPOSITE_MACRO_SOURCE } from '../context/src/adapters/compositeMacroAdapter.js';
import { createMarketContextProvider } from '../context/src/marketContext.js';

const baseNow = Date.parse('2026-09-16T17:50:00.000Z');

function adapter(source, events, { fail = false, fetchedAt = '2026-09-16T17:49:30.000Z' } = {}) {
  let calls = 0;
  return {
    source,
    async getSnapshot() {
      calls += 1;
      if (fail) throw new Error(`${source}_DOWN`);
      return { source, fetchedAt, events };
    },
    calls: () => calls
  };
}

test('merges required official macro sources and serves a bounded cache', async () => {
  let now = baseNow;
  const bls = adapter('BLS_OFFICIAL_RELEASE_CALENDAR', [
    { name: 'CPI', currency: 'USD', timestamp: '2026-09-17T12:30:00.000Z', impact: 'HIGH', source: 'BLS_OFFICIAL_RELEASE_CALENDAR' }
  ]);
  const fed = adapter('FEDERAL_RESERVE_OFFICIAL_CALENDAR', [
    { name: 'FOMC', currency: 'USD', timestamp: '2026-09-16T18:00:00.000Z', impact: 'HIGH', source: 'FEDERAL_RESERVE_OFFICIAL_CALENDAR' }
  ]);
  const composite = createCompositeMacroAdapter({ adapters: [bls, fed], now: () => now, cacheTtlMs: 600_000 });

  const first = await composite.getSnapshot();
  const second = await composite.getSnapshot();
  assert.equal(first.source, COMPOSITE_MACRO_SOURCE);
  assert.equal(first.completeness, 'ALL_REQUIRED_SOURCES_PRESENT');
  assert.equal(first.events.length, 2);
  assert.deepEqual(first.sources, ['BLS_OFFICIAL_RELEASE_CALENDAR', 'FEDERAL_RESERVE_OFFICIAL_CALENDAR']);
  assert.equal(bls.calls(), 1);
  assert.equal(fed.calls(), 1);
  assert.deepEqual(second, first);

  now += 600_001;
  await composite.getSnapshot();
  assert.equal(bls.calls(), 2);
  assert.equal(fed.calls(), 2);
});

test('fails closed when any required official macro source is unavailable', async () => {
  const bls = adapter('BLS_OFFICIAL_RELEASE_CALENDAR', [], { fail: true });
  const fed = adapter('FEDERAL_RESERVE_OFFICIAL_CALENDAR', [
    { name: 'FOMC', currency: 'USD', timestamp: '2026-09-16T18:00:00.000Z', impact: 'HIGH', source: 'FEDERAL_RESERVE_OFFICIAL_CALENDAR' }
  ]);
  const composite = createCompositeMacroAdapter({ adapters: [bls, fed], now: () => baseNow });
  await assert.rejects(() => composite.getSnapshot(), /COMPOSITE_MACRO_REQUIRED_SOURCE_UNAVAILABLE:BLS_OFFICIAL_RELEASE_CALENDAR/);
});

test('qualified composite macro can block BTC/USD around a verified FOMC window', async () => {
  const bls = adapter('BLS_OFFICIAL_RELEASE_CALENDAR', [
    { name: 'CPI', currency: 'USD', timestamp: '2026-09-17T12:30:00.000Z', impact: 'HIGH', source: 'BLS_OFFICIAL_RELEASE_CALENDAR' }
  ]);
  const fed = adapter('FEDERAL_RESERVE_OFFICIAL_CALENDAR', [
    { name: 'FOMC', currency: 'USD', timestamp: '2026-09-16T18:00:00.000Z', impact: 'HIGH', source: 'FEDERAL_RESERVE_OFFICIAL_CALENDAR' }
  ]);
  const composite = createCompositeMacroAdapter({ adapters: [bls, fed], now: () => baseNow });
  const provider = createMarketContextProvider({ macroAdapter: composite, now: () => baseNow });
  const context = await provider.getContext('BTC/USD');
  assert.equal(context.macro.status, 'HIGH');
  assert.equal(context.macro.blocked, true);
  assert.equal(context.macro.source, COMPOSITE_MACRO_SOURCE);
  assert.equal(context.news.status, 'NEWS_UNKNOWN');
});

test('runtime provider preserves UNKNOWN instead of LOW when composite macro fails', async () => {
  const failing = createCompositeMacroAdapter({
    adapters: [adapter('BLS_OFFICIAL_RELEASE_CALENDAR', [], { fail: true }), adapter('FEDERAL_RESERVE_OFFICIAL_CALENDAR', [])],
    now: () => baseNow
  });
  const provider = createMarketContextProvider({ macroAdapter: failing, now: () => baseNow });
  const context = await provider.getContext('BTC/USD');
  assert.equal(context.macro.status, 'MACRO_UNKNOWN');
  assert.equal(context.macro.blocked, false);
  assert.equal(context.macro.source, COMPOSITE_MACRO_SOURCE);
  assert.equal(context.macro.freshness.status, 'UNKNOWN');
});
