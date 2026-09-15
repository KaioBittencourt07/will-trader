import assert from 'node:assert/strict';
import test from 'node:test';
import { summarize, wilsonInterval } from '../learning/src/statistics.js';

test('evidence metrics preserve empty and tiny samples without implying performance', () => {
  const empty = summarize([]);
  assert.equal(empty.evidence.decisionN, 0);
  assert.equal(empty.evidence.winRate, null);
  assert.equal(empty.evidence.winRateInterval95, null);

  const tiny = summarize([{ direction: 'BUY', status: 'CLOSED', outcome: 'WIN' }]);
  assert.equal(tiny.evidence.winLossN, 1);
  assert.equal(tiny.evidence.warning.includes('Amostra insuficiente'), true);
  assert.deepEqual(wilsonInterval(1, 1), { method: 'wilson-95', lower: 0.20654329147389294, upper: 1, n: 1 });
});

test('evidence funnel retains WAIT, unresolved, tie and invalid outcomes with explicit N', () => {
  const metrics = summarize([
    { direction: 'WAIT', status: 'SKIPPED', metadata: { blockReasons: ['LOW_CONFIDENCE'] } },
    { direction: 'BUY', status: 'OPEN', execution: { status: 'CONFIRMED' } },
    { direction: 'SELL', status: 'CLOSED', outcome: 'VOID' },
    { direction: 'BUY', status: 'CLOSED', outcome: 'DATA_INVALID' },
    { direction: 'SELL', status: 'CLOSED', outcome: 'LOSS' }
  ]);
  assert.equal(metrics.evidence.decisionN, 5);
  assert.equal(metrics.evidence.resolvedN, 3);
  assert.equal(metrics.evidence.unresolved, 1);
  assert.equal(metrics.evidence.ties, 1);
  assert.equal(metrics.evidence.invalidOutcomes, 1);
  assert.equal(metrics.evidence.winLossN, 1);
  assert.equal(metrics.evidence.waitRate, 0.2);
  assert.equal(metrics.funnel.directionalCandidates, 4);
});

test('segments isolate strategy versions and expose data quality, session and blockers', () => {
  const metrics = summarize([
    {
      direction: 'BUY', status: 'CLOSED', outcome: 'WIN', asset: 'EUR/USD', setup: 'BREAKOUT', regime: 'TREND_UP', timeframe: '1min', strategyVersion: 'will-core-v1', modelVersion: 'deterministic-v1', signalTimestamp: '2026-09-02T08:00:00.000Z',
      metadata: { blockReasons: [], dataQuality: { valid: true, status: 'OK', source: 'twelvedata', ageMs: 200, candleCount: 50, requiredBars: 50 }, context: { decisionLatencyMs: 8 } }
    },
    {
      direction: 'WAIT', status: 'SKIPPED', asset: 'BTC/USD', setup: 'UNKNOWN', regime: 'TRANSITION', timeframe: '1min', strategyVersion: 'will-core-v1.1', modelVersion: 'deterministic-v1', signalTimestamp: '2026-09-02T22:00:00.000Z',
      metadata: { blockReasons: ['UNKNOWN_SETUP'], dataQuality: { valid: false, status: 'STALE', source: 'twelvedata', ageMs: 90_000, candleCount: 42, requiredBars: 50 }, context: { decisionLatencyMs: 5 } }
    }
  ]);
  const v1 = metrics.segments.byStrategyVersion.find((item) => item.key === 'will-core-v1');
  const v11 = metrics.segments.byStrategyVersion.find((item) => item.key === 'will-core-v1.1');
  assert.equal(v1.n, 1);
  assert.equal(v1.wins, 1);
  assert.equal(v11.n, 1);
  assert.equal(v11.waits, 1);
  assert.equal(metrics.segments.bySession.find((item) => item.key === 'EUROPE_UTC').n, 1);
  assert.equal(metrics.segments.byDataQualityStatus.find((item) => item.key === 'STALE').n, 1);
  assert.deepEqual(metrics.blockers, [{ key: 'UNKNOWN_SETUP', n: 1 }]);
  assert.equal(metrics.dataQuality.missingBars.total, 8);
  assert.equal(metrics.latency.decisionMs.n, 2);
});

test('segments retain prospective shadow dimensions without interpreting them as probability', () => {
  const metrics = summarize([{
    direction: 'WAIT', status: 'SKIPPED', metadata: {
      dataQuality: { status: 'OK', source: 'feed' },
      prospective: {
        providerState: 'HEALTHY',
        timing: { status: 'WAIT_TIMING' },
        mtf: { status: 'SHADOW' },
        familiarity: { status: 'UNFAMILIAR' },
        lifecycle: { state: 'FORMING' },
        disagreement: { status: 'MIXED' },
        robustness: { status: 'SENSITIVE' },
        drift: { status: 'WATCH' }
      }
    }
  }]);
  assert.equal(metrics.segments.byTimingStatus[0].key, 'WAIT_TIMING');
  assert.equal(metrics.segments.byDriftStatus[0].key, 'WATCH');
  assert.equal(metrics.evidence.winRate, null);
});

