import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalResearchAssets } from '../backend/src/routes/opportunities.js';
import { prospectiveResearchGate } from '../data/src/providers/prospectiveResearchGate.js';
import { createAvalonCatalog } from '../data/src/brokerCatalog.js';

test('PAPER research accepts canonical market symbols without an Avalon catalog', () => {
  const unverifiedAvalon = createAvalonCatalog({ environment: {} });
  assert.equal(unverifiedAvalon.isConfirmed(), false);
  // USD/CAD is canonical market research, but not in the example Avalon list.
  assert.deepEqual(canonicalResearchAssets(['EUR/USD', 'USD/CAD']), ['EUR/USD', 'USD/CAD']);
  assert.throws(() => canonicalResearchAssets(['NOT/A/REAL']), /universo canônico de pesquisa/);
});

test('prospective research gate depends only on real Twelve Data health', () => {
  assert.deepEqual(prospectiveResearchGate({ ok: true, diagnostic: { status: 'HEALTHY' } }), {
    ready: true, status: 'MARKET_DATA_GATE_HEALTHY', providerStatus: 'HEALTHY'
  });
  for (const status of ['RATE_LIMITED', 'NETWORK_BLOCKED', 'INVALID_RESPONSE', 'STALE_DATA', 'CREDENTIAL_ERROR']) {
    const gate = prospectiveResearchGate({ ok: false, diagnostic: { status } });
    assert.equal(gate.ready, false);
    assert.equal(gate.status, `MARKET_DATA_GATE_${status}`);
  }
});

