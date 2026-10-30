import assert from 'node:assert/strict';
import test from 'node:test';
import { composeCoinbaseTwelveOperationalSnapshot } from '../backend/src/coinbaseTwelveOperationalSnapshot.js';
import { evaluateMarketAdmission } from '../backend/src/marketAdmissionGate.js';
import { buildCanonicalMarketSnapshot, buildCanonicalStrategyInput } from '../backend/src/canonicalMarketSnapshot.js';

const EVENT = Date.parse('2026-09-14T12:01:20.250Z');

function fixtures() {
  const candles = [];
  const base = Date.parse('2026-09-14T12:00:00.000Z');
  for (let i = 1; i >= -60; i -= 1) {
    const close = 76000 + i;
    candles.push({
      datetime: new Date(base + i * 60_000).toISOString(),
      open: String(close - 5), high: String(close + 10), low: String(close - 10), close: String(close)
    });
  }
  return {
    twelveSnapshot: { asset: 'BTC/USD', timeframe: '1min', candles, source: 'twelvedata' },
    coinbaseHealth: {
      ready: true,
      latestTick: { symbol: 'BTC/USD', price: 76020, eventTimestamp: EVENT, receivedAt: '2026-09-14T12:01:20.300Z' },
      temporalAuthority: {
        version: 'temporal-authority-provider-v1', provider: 'coinbase-exchange-ticker', source: 'coinbase-exchange-ticker', symbol: 'BTC/USD',
        timestampAuthority: 'COINBASE_EXCHANGE_TICKER_MATCH_TIME', provenanceVerified: true, perEventSemanticsVerified: true,
        comparableToReceiveClock: true, authorityGate: 'PASS', freshnessGate: 'PASS', freshnessContractMs: 30_000,
        eventTimestamp: EVENT, receivedAt: '2026-09-14T12:01:20.300Z', eventAgeMs: 100, receiveAgeMs: 50,
        clockSkewMs: 50, reasons: [], blocker: null, decisionImpact: 'ALLOW_ANALYSIS_ONLY', ordersExecuted: 0
      }
    }
  };
}

test('composite BTC observation is admitted and canonicalized using closed candles only', () => {
  const input = fixtures();
  const snapshot = composeCoinbaseTwelveOperationalSnapshot({ ...input, now: EVENT + 100, requiredBars: 50 });
  assert.equal(snapshot.valid, true);

  const admission = evaluateMarketAdmission(snapshot, { requireAuthoritativeFreshness: true });
  assert.equal(admission.admitted, true);
  assert.equal(admission.checks.authorityGate, 'PASS');
  assert.equal(admission.checks.freshnessGate, 'PASS');

  const canonical = buildCanonicalMarketSnapshot({
    snapshot: admission.snapshot,
    admission: { version: admission.version, state: admission.state, stage: admission.stage, checks: admission.checks },
    now: EVENT + 100,
    requiredBars: 50
  });
  assert.equal(canonical.valid, true);
  assert.equal(canonical.state, 'READY');
  assert.equal(canonical.timestampAuthority, 'COINBASE_EXCHANGE_TICKER_MATCH_TIME');
  assert.equal(canonical.latestClosedCandleTimestamp, '2026-09-14T12:00:00.000Z');

  const strategy = buildCanonicalStrategyInput({ snapshot: admission.snapshot, canonicalSnapshot: canonical });
  assert.equal(strategy.valid, true);
  assert.equal(strategy.candleCount, 50);
  assert.equal(strategy.candles.some((bar) => bar.datetime === '2026-09-14T12:01:00.000Z'), false);
  assert.equal(strategy.featureVersion, 'candle-price-action-v2');
});
