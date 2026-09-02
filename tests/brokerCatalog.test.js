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
