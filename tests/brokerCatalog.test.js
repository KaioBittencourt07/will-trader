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
