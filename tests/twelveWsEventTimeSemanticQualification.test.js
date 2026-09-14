import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifyTwelveWsEventTimeSemantic } from '../backend/src/twelveWsEventTimeSemanticQualification.js';

function health({
  acceptedTicks = 4,
  distinctEventTimestamps = 4,
  repeatedTimestampPriceChanges = 0,
  timestampRegressions = 0,
  minuteAlignedTicks = 0,
  maxAbsEventReceiveSkewMs = 750
} = {}) {
  return {
    symbols: [{
      symbol: 'EUR/USD',
      eventTimeDiagnostics: {
        acceptedTicks,
        distinctEventTimestamps,
        repeatedTimestampPriceChanges,
        timestampRegressions,
        minuteAlignedTicks,
        maxAbsEventReceiveSkewMs
      }
    }]
  };
}

test('official field provenance alone does not authorize per-event freshness', () => {
  const result = qualifyTwelveWsEventTimeSemantic();
  assert.equal(result.fieldProvenanceVerified, true);
  assert.equal(result.provenanceVerified, false);
  assert.equal(result.canEvaluateFrozenFreshness, false);
  assert.equal(result.semanticClassification, 'PROVIDER_UNIX_TIMESTAMP_PER_EVENT_SEMANTICS_UNRESOLVED');
});

test('qualifies per-event WS timestamp only with coherent runtime progression', () => {
  const result = qualifyTwelveWsEventTimeSemantic({ wsHealth: health(), symbol: 'EUR/USD' });
  assert.equal(result.fieldProvenanceVerified, true);
  assert.equal(result.provenanceVerified, true);
  assert.equal(result.comparableToReceiveClock, true);
  assert.equal(result.canEvaluateFrozenFreshness, true);
  assert.equal(result.semanticClassification, 'PROVIDER_REALTIME_EVENT_UNIX_TIMESTAMP_EMPIRICALLY_QUALIFIED');
});

test('detects coarse or bucketed timestamp evidence when prices change under the same timestamp', () => {
  const result = qualifyTwelveWsEventTimeSemantic({
    wsHealth: health({
      acceptedTicks: 8,
      distinctEventTimestamps: 1,
      repeatedTimestampPriceChanges: 5,
      minuteAlignedTicks: 8,
      maxAbsEventReceiveSkewMs: 56_000
    }),
    symbol: 'EUR/USD'
  });
  assert.equal(result.provenanceVerified, false);
  assert.equal(result.canEvaluateFrozenFreshness, false);
  assert.equal(result.semanticClassification, 'PROVIDER_COARSE_OR_BUCKETED_UNIX_TIMESTAMP_OBSERVED');
  assert.ok(result.semanticReasonCodes.includes('WS_MULTIPLE_PRICE_CHANGES_SHARE_EVENT_TIMESTAMP'));
});

test('fails closed when endpoint, event, or timestamp field diverges from the qualified contract', () => {
  assert.equal(qualifyTwelveWsEventTimeSemantic({ endpoint: '/other', wsHealth: health() }).fieldProvenanceVerified, false);
  assert.equal(qualifyTwelveWsEventTimeSemantic({ eventType: 'quote', wsHealth: health() }).fieldProvenanceVerified, false);
  assert.equal(qualifyTwelveWsEventTimeSemantic({ timestampField: 'time', wsHealth: health() }).fieldProvenanceVerified, false);
});
