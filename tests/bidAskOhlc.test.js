import assert from 'node:assert/strict';
import test from 'node:test';
import { BID_ASK_OHLC_VERSION, transformSaxoBidAskChartsOffline, transformSaxoChartsOffline } from '../data/src/providers/saxoQualification.js';
import { composeSaxoBidAskIndependentQuote } from '../data/src/crossProviderComposition.js';
import { createMultiProviderOhlc } from '../data/src/multiProviderOhlc.js';

const NOW = Date.parse('2026-09-09T20:00:20Z');
const sample = (overrides = {}) => ({ Time: '2026-09-09T19:59:00Z', OpenBid: 1.10, HighBid: 1.12, LowBid: 1.09, CloseBid: 1.11,
  OpenAsk: 1.101, HighAsk: 1.121, LowAsk: 1.091, CloseAsk: 1.111, ...overrides });
const input = (overrides = {}) => ({ chartResponse: { ChartInfo: { Horizon: 1, FirstSampleTime: '2020-01-01T00:00:00Z' }, DataVersion: 1,
  Data: [sample()] }, sampleEvidence: 'SUBSCRIPTION_INITIAL_SNAPSHOT', receivedAt: new Date(NOW).toISOString(), ...overrides });
const quote = () => ({ mode: 'SHADOW_OBSERVABILITY', connected: true, subscriptionsAccepted: 1, subscriptionsRejected: 0,
  symbols: [{ symbol: 'EUR/USD', price: 1.1105, eventTimestamp: NOW - 5_000, receivedAt: new Date(NOW - 1_000).toISOString() }] });

test('documentary BidAsk is valid provider evidence but Champion incompatible', () => {
  const value = transformSaxoBidAskChartsOffline(input());
  assert.equal(value.contractVersion, BID_ASK_OHLC_VERSION); assert.equal(value.providerEvidenceValid, true);
  assert.equal(value.marketDataRepresentation, 'BID_ASK_OHLC'); assert.equal(value.championCompatible, false);
  assert.deepEqual(value.candles[0].bid, { open: 1.10, high: 1.12, low: 1.09, close: 1.11 });
  assert.deepEqual(value.candles[0].ask, { open: 1.101, high: 1.121, low: 1.091, close: 1.111 });
  assert.equal(value.midpoint, null); assert.equal(value.selectedSide, null);
  assert.equal('open' in value.candles[0], false); assert.equal('price' in value, false);
});

test('incomplete BidAsk and invalid ranges fail closed independently', () => {
  assert.throws(() => transformSaxoBidAskChartsOffline(input({ chartResponse: { ...input().chartResponse, Data: [sample({ CloseAsk: null })] } })), /SAXO_ASK_OHLC_MALFORMED/);
  assert.throws(() => transformSaxoBidAskChartsOffline(input({ chartResponse: { ...input().chartResponse, Data: [sample({ HighBid: 1.08 })] } })), /SAXO_BID_OHLC_MALFORMED/);
  assert.throws(() => transformSaxoBidAskChartsOffline(input({ chartResponse: { ...input().chartResponse, Data: [sample({ LowAsk: 1.13 })] } })), /SAXO_ASK_OHLC_MALFORMED/);
});

test('no undocumented cross-side gate is imposed', () => {
  const value = transformSaxoBidAskChartsOffline(input({ chartResponse: { ...input().chartResponse,
    Data: [sample({ OpenAsk: 1.05, HighAsk: 1.07, LowAsk: 1.04, CloseAsk: 1.06 })] } }));
  assert.equal(value.providerEvidenceValid, true);
  assert.equal(value.crossSideInvariant, 'NOT_ENFORCED_DOCUMENTATION_INSUFFICIENT');
});

test('single-OHLC transformer remains backward compatible and separate', () => {
  const direct = input({ chartResponse: { ...input().chartResponse, Data: [{ Time: '2026-09-09T19:59:00Z', Open: 1.1, High: 1.2, Low: 1.0, Close: 1.15 }] } });
  assert.equal(transformSaxoChartsOffline(direct).candles[0].close, 1.15);
  assert.throws(() => transformSaxoChartsOffline(input()), /SAXO_OHLC_MALFORMED/);
});

test('BidAsk plus fresh independent quote remains semantic-only and non-decisional', () => {
  const result = composeSaxoBidAskIndependentQuote({ saxoSnapshot: transformSaxoBidAskChartsOffline(input()), quoteHealth: quote(), now: NOW });
  assert.equal(result.compositionState, 'PROVIDER_EVIDENCE_COMPOSABLE_OFFLINE');
  assert.equal(result.providerEvidenceValid, true); assert.equal(result.championCompatible, false); assert.equal(result.valid, false);
  assert.equal(result.decisionImpact, 'NONE'); assert.equal(result.prospectivePaperAuthorized, false); assert.equal(result.ordersExecuted, 0);
  assert.equal(result.midpoint, null); assert.equal(result.selectedSide, null);
  assert.equal('direction' in result, false); assert.equal('score' in result, false);
  assert.deepEqual(result.separation, { quoteProviderDeclaresCandleClosed: false, ohlcProviderDeclaresQuoteFresh: false,
    representationConversion: false, midpointCreated: false, selectedSide: false, championBypass: false });
});

test('valid BidAsk provider evidence cannot enter the current Champion market-data gate', async () => {
  const evidence = transformSaxoBidAskChartsOffline(input());
  const layer = createMultiProviderOhlc({ providers: [{ id: 'saxo-bid-ask', symbols: { 'EUR/USD': 'EURUSD' }, engine: {
    getProviderReadiness: () => ({ state: 'READY' }), getSnapshot: async () => evidence
  } }] });
  await assert.rejects(() => layer.getSnapshot('EUR/USD'), (error) => error.code === 'ALL_PROVIDERS_UNAVAILABLE');
  assert.equal(evidence.prospectivePaperAuthorized, false); assert.equal(evidence.ordersExecuted, 0);
});
