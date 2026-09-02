import assert from 'node:assert/strict';
import test from 'node:test';
import { assetCurrencies, buildMarketContext, createMarketContextProvider } from '../context/src/marketContext.js';

const now = Date.parse('2026-09-02T12:00:00.000Z');
const fresh = '2026-09-02T11:59:00.000Z';

test('maps macro events only to their affected currencies and blocks high-impact events in-window', () => {
  const context = buildMarketContext({ asset: 'EUR/USD', now, macro: { source: 'calendar', fetchedAt: fresh, events: [{ name: 'FOMC', currency: 'USD', timestamp: '2026-09-02T12:05:00.000Z' }, { name: 'BOE_RATE', currency: 'GBP', timestamp: '2026-09-02T12:05:00.000Z' }] }, news: { source: 'news', fetchedAt: fresh, items: [] } });
  assert.deepEqual(assetCurrencies('EUR/USD'), ['EUR', 'USD']);
  assert.equal(context.macro.blocked, true);
  assert.equal(context.macro.events.length, 1);
});

test('CPI, NFP, ECB, BOE and PCE retain high-impact veto semantics only inside configured windows', () => {
  for (const name of ['CPI', 'NFP', 'ECB_RATE', 'BOE_RATE', 'PCE']) {
    const currency = name.startsWith('ECB') ? 'EUR' : name.startsWith('BOE') ? 'GBP' : 'USD';
    const context = buildMarketContext({ asset: currency === 'EUR' ? 'EUR/USD' : currency === 'GBP' ? 'GBP/USD' : 'USD/JPY', now, macro: { source: 'calendar', fetchedAt: fresh, events: [{ name, currency, timestamp: '2026-09-02T12:01:00.000Z' }] } });
    assert.equal(context.macro.blocked, true, name);
  }
  const outside = buildMarketContext({ asset: 'EUR/USD', now, macro: { source: 'calendar', fetchedAt: fresh, events: [{ name: 'CPI', currency: 'USD', timestamp: '2026-09-02T14:00:00.000Z' }] } });
  assert.equal(outside.macro.blocked, false);
});

test('missing or stale providers stay UNKNOWN instead of being reported as low risk', async () => {
  const missing = buildMarketContext({ asset: 'EUR/USD', now });
  const stale = buildMarketContext({ asset: 'EUR/USD', now, macro: { source: 'calendar', fetchedAt: '2026-09-02T10:00:00.000Z' } });
  assert.equal(missing.macro.status, 'MACRO_UNKNOWN');
  assert.equal(missing.news.status, 'NEWS_UNKNOWN');
  assert.equal(stale.macro.status, 'MACRO_UNKNOWN');
  const provider = createMarketContextProvider({ macroAdapter: { source: 'test', async getSnapshot() { return { source: 'test', fetchedAt: fresh, events: [] }; } }, now: () => now });
  assert.equal((await provider.getContext('AUD/USD')).macro.status, 'LOW');
});
