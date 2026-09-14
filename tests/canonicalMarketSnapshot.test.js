import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCanonicalMarketSnapshot, buildCanonicalStrategyInput, createCanonicalStudyFingerprint } from '../backend/src/canonicalMarketSnapshot.js';

const NOW = Date.parse('2026-09-14T12:00:20.000Z');

function candles(count = 50) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const t = NOW - (count - i) * 60_000;
    const base = 1.1 + i * 0.0001;
    out.push({ datetime: new Date(t).toISOString(), open: base, high: base + 0.0002, low: base - 0.0002, close: base + 0.0001 });
  }
  return out;
}

function readySnapshot(overrides = {}) {
  const bars = candles(50);
  return {
    asset: 'EUR/USD', timeframe: '1min', price: 1.105,
    trend: 0.4, momentum: 0.3, structure: 0.2, volatility: 0.4, confirmations: 4,
    featureVersion: 'candle-price-action-v2', source: 'cross-provider', candles: bars,
    candleCompleteness: 'VERIFIED_CLOSED_BY_DOCUMENTED_CHART_CONTEXT',
    latestClosedCandleTimestamp: bars.at(-1).datetime,
    timestampOrigins: { quoteTimestamp: 'independent.quote.eventTime', candleTimestamp: 'saxo.chart.Data[].Time' },
    authoritativeFreshness: { authorityGate: 'PASS', freshnessGate: 'PASS', timestampAuthority: 'INDEPENDENT_PROVIDER_EVENT_TIME', freshnessContractMs: 30_000, eventTimestamp: NOW - 5_000 },
    ...overrides
  };
}

const admission = { version: 'market-admission-gate-v1', state: 'ADMITTED' };

test('builds a ready canonical snapshot only with explicit admission, temporal authority and closed candles', () => {
  const value = buildCanonicalMarketSnapshot({ snapshot: readySnapshot(), admission, now: NOW, requiredBars: 50 });
  assert.equal(value.valid, true); assert.equal(value.state, 'READY'); assert.equal(value.closedCandles.length, 50);
  assert.equal(value.freshnessContractMs, 30_000); assert.equal(value.admissionProof.state, 'ADMITTED');
});

test('fails closed without admission proof or approved temporal authority', () => {
  const noAdmission = buildCanonicalMarketSnapshot({ snapshot: readySnapshot(), now: NOW });
  assert.ok(noAdmission.reasons.includes('CANONICAL_ADMISSION_NOT_PROVEN'));
  const badTemporal = buildCanonicalMarketSnapshot({ snapshot: readySnapshot({ authoritativeFreshness: { authorityGate: 'FAIL', freshnessGate: 'UNVERIFIED', timestampAuthority: 'UNRESOLVED', freshnessContractMs: 30_000 } }), admission, now: NOW });
  assert.ok(badTemporal.reasons.includes('CANONICAL_TEMPORAL_AUTHORITY_NOT_APPROVED')); assert.equal(badTemporal.valid, false);
});

test('fails closed when closed-candle proof is missing or current/open bar leaks into structural input', () => {
  const missingProof = buildCanonicalMarketSnapshot({ snapshot: readySnapshot({ candleCompleteness: 'UNVERIFIED_BY_PROVIDER_PAYLOAD' }), admission, now: NOW });
  assert.ok(missingProof.reasons.includes('CANONICAL_CLOSED_CANDLE_PROOF_MISSING'));
  const base = readySnapshot();
  const withOpen = { ...base, candles: [...base.candles, { datetime: new Date(NOW).toISOString(), open: 2, high: 2.1, low: 1.9, close: 2 }] };
  const value = buildCanonicalMarketSnapshot({ snapshot: withOpen, admission, now: NOW });
  assert.equal(value.closedCandles.length, 50); assert.equal(value.closedCandles.at(-1).timestamp, new Date(Date.parse(base.latestClosedCandleTimestamp)).toISOString());
});

test('canonical strategy input uses authoritative event time and closed candles only', () => {
  const source = readySnapshot();
  source.timestamp = new Date(NOW).toISOString();
  source.candles = [...source.candles, { datetime: new Date(NOW).toISOString(), open: 2, high: 2.1, low: 1.9, close: 2 }];
  const canonical = buildCanonicalMarketSnapshot({ snapshot: source, admission, now: NOW });
  const input = buildCanonicalStrategyInput({ snapshot: source, canonicalSnapshot: canonical });
  assert.equal(input.timestamp, new Date(NOW - 5_000).toISOString());
  assert.equal(input.candles.length, 50);
  assert.equal(input.candleCount, 50);
  assert.equal(input.canonicalSnapshotVersion, 'canonical-market-snapshot-v1');
  assert.equal(input.trend, 0.4);
});

test('study fingerprint is deterministic and ignores live price changes while closed structure is unchanged', () => {
  const a = buildCanonicalMarketSnapshot({ snapshot: readySnapshot({ price: 1.105 }), admission, now: NOW });
  const b = buildCanonicalMarketSnapshot({ snapshot: readySnapshot({ price: 1.106 }), admission, now: NOW });
  assert.equal(createCanonicalStudyFingerprint(a).hash, createCanonicalStudyFingerprint(b).hash);
});

test('study fingerprint changes when the closed market structure changes', () => {
  const a = buildCanonicalMarketSnapshot({ snapshot: readySnapshot(), admission, now: NOW });
  const changed = readySnapshot();
  changed.candles = changed.candles.map((bar, index) => index === changed.candles.length - 1 ? { ...bar, close: Number(bar.close) + 0.0004, high: Number(bar.high) + 0.0004 } : bar);
  const b = buildCanonicalMarketSnapshot({ snapshot: changed, admission, now: NOW });
  assert.notEqual(createCanonicalStudyFingerprint(a).hash, createCanonicalStudyFingerprint(b).hash);
});
