import assert from 'node:assert/strict';
import test from 'node:test';
import { AVALON_PUBLIC_CATALOG, createAvalonCatalog } from '../data/src/brokerCatalog.js';

test('Avalon catalog contains only the configured operational symbols', () => {
  const catalog = createAvalonCatalog({ environment: {} });
  assert.equal(catalog.isAllowed('AUD/USD'), true);
  assert.equal(catalog.isAllowed('USD/CAD'), false);
  assert.deepEqual(catalog.universes.FOREX, AVALON_PUBLIC_CATALOG.FOREX);
});

test('Avalon catalog accepts the account-specific allowlist and rejects unknown symbols', () => {
  const catalog = createAvalonCatalog({ environment: { AVALON_FOREX_ASSETS: 'EUR/USD, USD/CAD' } });
  assert.deepEqual(catalog.assertAllowed(['eur/usd', 'USD/CAD']), ['EUR/USD', 'USD/CAD']);
  assert.throws(() => catalog.assertAllowed(['EUR/USD', 'NOT/A/REAL']), /fora do catálogo operacional Avalon/);
});

test('operational tradability requires an explicit verified catalog and maps broker aliases', () => {
  const unverified = createAvalonCatalog({ environment: {} });
  assert.equal(unverified.resolve('SOL/USD').brokerTradable, false);
  assert.equal(unverified.resolve('SOL/USD').status, 'AVALON_CATALOG_UNVERIFIED');
  const verified = createAvalonCatalog({ environment: { AVALON_FOREX_ASSETS: 'EUR/USD', AVALON_CATALOG_SOURCE: 'account-platform-export', AVALON_CATALOG_VERIFIED_AT: '2026-09-02T12:00:00.000Z', AVALON_SYMBOL_ALIASES: '{"EUR/USD":"EURUSD"}' } });
  assert.equal(verified.resolve('EUR/USD').brokerTradable, true);
  assert.equal(verified.resolve('EUR/USD').brokerSymbol, 'EURUSD');
  assert.equal(verified.resolve('SOL/USD').status, 'NOT_TRADABLE_ON_AVALON');
});

test('empty confirmed catalog is safe and does not create an operational universe', () => {
  const catalog = createAvalonCatalog({ environment: { AVALON_FOREX_ASSETS: '', AVALON_CRYPTO_ASSETS: '', AVALON_STOCK_ASSETS: '', AVALON_CATALOG_SOURCE: 'account-export', AVALON_CATALOG_VERIFIED_AT: '2026-09-02T12:00:00.000Z' } });
  assert.equal(catalog.isConfirmed(), true);
  assert.deepEqual(catalog.operationalUniverses.FOREX, []);
});

test('file allowlist is read-only, explicit and maps only verified TRADABLE assets', () => {
  const document = JSON.stringify({
    version: 'avalon-allowlist-v1', source: 'Kaio manual platform export', verifiedAt: '2026-09-03T10:00:00.000Z',
    assets: [
      { asset: 'EUR/USD', brokerSymbol: 'EURUSD', source: 'Kaio manual platform export', verifiedAt: '2026-09-03T10:00:00.000Z', status: 'TRADABLE' },
      { asset: 'BTC/USD', brokerSymbol: 'BTCUSD', source: 'Kaio manual platform export', verifiedAt: '2026-09-03T10:00:00.000Z', status: 'NOT_TRADABLE' }
    ]
  });
  let reads = 0;
  const catalog = createAvalonCatalog({ environment: { AVALON_ALLOWLIST_FILE: 'avalon.json' }, readFile: () => { reads += 1; return document; }, now: () => Date.parse('2026-09-03T10:30:00.000Z') });
  assert.equal(reads, 1);
  assert.equal(catalog.isConfirmed(), true);
  assert.equal(catalog.resolve('EUR/USD').brokerSymbol, 'EURUSD');
  assert.equal(catalog.resolve('EUR/USD').brokerTradable, true);
  assert.equal(catalog.resolve('BTC/USD').brokerTradable, false);
  assert.equal(catalog.resolve('SOL/USD').status, 'NOT_TRADABLE_ON_AVALON');
});

test('missing, invalid or expired allowlist stays fail-closed', () => {
  const base = { version: 'avalon-allowlist-v1', assets: [{ asset: 'EUR/USD', brokerSymbol: 'EURUSD', source: 'manual export', verifiedAt: '2026-09-01T00:00:00.000Z', status: 'TRADABLE' }] };
  const expired = createAvalonCatalog({ environment: { AVALON_ALLOWLIST_FILE: 'avalon.json' }, readFile: () => JSON.stringify(base), now: () => Date.parse('2026-09-03T00:00:00.000Z') });
  const invalid = createAvalonCatalog({ environment: { AVALON_ALLOWLIST_FILE: 'avalon.json' }, readFile: () => '{bad json', now: () => Date.parse('2026-09-03T00:00:00.000Z') });
  assert.equal(expired.isConfirmed(), false);
  assert.equal(expired.catalogStatus, 'AVALON_CATALOG_UNVERIFIED');
  assert.equal(expired.resolve('EUR/USD').status, 'AVALON_CATALOG_UNVERIFIED');
  assert.equal(invalid.catalogReason, 'ALLOWLIST_UNREADABLE_OR_INVALID');
  assert.equal(invalid.resolve('EUR/USD').brokerTradable, false);
});

