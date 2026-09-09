import assert from 'node:assert/strict';
import test from 'node:test';
import { classifySaxoFailure, diagnoseSaxoChartSnapshotStructure, SAXO_QUALIFICATION, transformSaxoChartsOffline } from '../data/src/providers/saxoQualification.js';
import { createMultiProviderOhlc } from '../data/src/multiProviderOhlc.js';

const NOW = '2026-09-09T12:00:20.000Z';
const bar = (Time, values = {}) => ({ Time, Open: 1.17, High: 1.171, Low: 1.169, Close: 1.1705, ...values });
function payload(overrides = {}) {
  return { chartResponse: { ChartInfo: { Horizon: 1, FirstSampleTime: '2020-01-01T00:00:00.000Z', DelayedByMinutes: 0 }, DataVersion: 42,
    Data: [bar('2026-09-09T11:58:00.000Z'), bar('2026-09-09T11:59:00.000Z')] },
    sampleEvidence: 'SUBSCRIPTION_INITIAL_SNAPSHOT', receivedAt: NOW, ...overrides };
}

test('maps documented EURUSD UIC 21 FxSpot explicitly', () => {
  assert.deepEqual([SAXO_QUALIFICATION.providerSymbol, SAXO_QUALIFICATION.uic, SAXO_QUALIFICATION.assetType], ['EURUSD', 21, 'FxSpot']);
  assert.throws(() => transformSaxoChartsOffline(payload({ uic: 22 })), /SYMBOL_MAPPING_MISMATCH/);
  assert.throws(() => transformSaxoChartsOffline(payload({ providerSymbol: 'EUR\/USD' })), /SYMBOL_MAPPING_MISMATCH/);
});

test('maps WILL 1min only to Saxo Horizon 1', () => {
  assert.equal(transformSaxoChartsOffline(payload()).horizon, 1);
  assert.throws(() => transformSaxoChartsOffline(payload({ horizon: 5 })), /TIMEFRAME_MAPPING_MISMATCH/);
  const p = payload(); p.chartResponse.ChartInfo.Horizon = 5;
  assert.throws(() => transformSaxoChartsOffline(p), /RESPONSE_TIMEFRAME_MISMATCH/);
});

test('subscription initial snapshot samples are completed by documented context', () => {
  const value = transformSaxoChartsOffline(payload());
  assert.equal(value.candleCompleteness, 'VERIFIED_CLOSED_BY_DOCUMENTED_CHART_CONTEXT');
  assert.equal(value.completenessRule, 'PROVIDER_DOCUMENTED_INITIAL_SNAPSHOT_COMPLETED_SAMPLES');
  assert.equal(value.latestClosedCandleTimestamp, '2026-09-09T11:59:00.000Z');
});

test('same streaming update with closed and newly opened samples excludes current sample', () => {
  const p = payload({ sampleEvidence: 'STREAM_UPDATE_CLOSED_AND_OPENED' });
  const value = transformSaxoChartsOffline(p);
  assert.equal(value.latestClosedCandleTimestamp, '2026-09-09T11:58:00.000Z');
  assert.equal(value.currentSample.datetime, '2026-09-09T11:59:00.000Z');
  assert.equal(value.candles.length, 1);
});

test('single/current update and unlabelled REST array cannot prove closed status', () => {
  const current = payload({ sampleEvidence: 'STREAM_UPDATE_CLOSED_AND_OPENED' }); current.chartResponse.Data = [bar('2026-09-09T11:59:00Z')];
  assert.throws(() => transformSaxoChartsOffline(current), /STREAM_COMPLETENESS_AMBIGUOUS/);
  assert.throws(() => transformSaxoChartsOffline(payload({ sampleEvidence: 'REST_GET' })), /SAMPLE_COMPLETENESS_UNVERIFIED/);
});

test('orders by Time rather than array position and rejects malformed OHLC', () => {
  const value = transformSaxoChartsOffline(payload());
  assert.equal(value.candles[0].datetime, '2026-09-09T11:59:00.000Z');
  const malformed = payload(); malformed.chartResponse.Data[0].High = null;
  assert.throws(() => transformSaxoChartsOffline(malformed), /OHLC_MALFORMED/);
  const range = payload(); range.chartResponse.Data[0].Close = 2;
  assert.throws(() => transformSaxoChartsOffline(range), /OHLC_MALFORMED/);
});

test('missing sample, Time, DataVersion and FirstSampleTime fail closed', () => {
  const empty = payload(); empty.chartResponse.Data = [];
  assert.throws(() => transformSaxoChartsOffline(empty), /OHLC_DATA_EMPTY/);
  const missing = payload(); delete missing.chartResponse.Data;
  assert.throws(() => transformSaxoChartsOffline(missing), /OHLC_DATA_MISSING/);
  const time = payload(); delete time.chartResponse.Data[0].Time;
  assert.throws(() => transformSaxoChartsOffline(time), /OHLC_MALFORMED/);
  const version = payload(); delete version.chartResponse.DataVersion;
  assert.throws(() => transformSaxoChartsOffline(version), /DATA_VERSION_MISSING/);
  const first = payload(); delete first.chartResponse.ChartInfo.FirstSampleTime;
  assert.throws(() => transformSaxoChartsOffline(first), /FIRST_SAMPLE_TIME_MISSING/);
});

test('chart never substitutes candle freshness for independent quote freshness', () => {
  const value = transformSaxoChartsOffline(payload());
  assert.equal(value.status, 'INVALID');
  assert.equal(value.reason, 'QUOTE_FRESHNESS_UNVERIFIED');
  assert.equal(value.quoteTimestamp, null);
  assert.equal(value.quoteAgeMs, null);
  assert.equal(value.freshnessBasis, 'INDEPENDENT_QUOTE_TIMESTAMP_REQUIRED_BUT_ABSENT');
});

test('30-second gate is frozen even though chart cannot evaluate quote age', () => {
  assert.equal(transformSaxoChartsOffline(payload()).freshnessMaxAgeMs, 30_000);
  assert.throws(() => transformSaxoChartsOffline(payload({ maxAgeMs: 30_001 })), /FRESHNESS_GATE_FROZEN/);
});

test('preserves Time, receive time, DataVersion, delay and FirstSampleTime provenance', () => {
  const value = transformSaxoChartsOffline(payload());
  assert.equal(value.providerReceivedAt, NOW);
  assert.equal(value.dataVersion, 42);
  assert.equal(value.delayedByMinutes, 0);
  assert.equal(value.firstSampleTime, '2020-01-01T00:00:00.000Z');
  assert.equal(value.timestampOrigins.candleTimestamp, 'saxo.chart.v3.response.Data[].Time');
  assert.notEqual(value.latestClosedCandleTimestamp, value.providerReceivedAt);
});

test('documented HTTP response codes map conservatively', () => {
  assert.equal(classifySaxoFailure({ status: 401 }), 'MISCONFIGURED');
  assert.equal(classifySaxoFailure({ status: 403 }), 'MISCONFIGURED');
  assert.equal(classifySaxoFailure({ status: 429 }), 'RATE_LIMITED');
  assert.equal(classifySaxoFailure({ status: 503 }), 'UNAVAILABLE');
  assert.equal(classifySaxoFailure(new Error('network timeout')), 'UNAVAILABLE');
});

test('quote-freshness limitation fails unchanged multi-provider contract closed', async () => {
  const snapshot = transformSaxoChartsOffline(payload());
  const multi = createMultiProviderOhlc({ providers: [{ id: 'saxo', symbols: { 'EUR/USD': 'EURUSD' }, engine: {
    getProviderReadiness: () => ({ state: 'READY' }), getSnapshot: async () => snapshot
  } }] });
  await assert.rejects(() => multi.getSnapshot('EUR/USD'), (error) => error.code === 'ALL_PROVIDERS_UNAVAILABLE');
});

test('structural diagnostic recognizes documentary direct OHLC without raw values', () => {
  const diagnostic = diagnoseSaxoChartSnapshotStructure(payload().chartResponse);
  assert.equal(diagnostic.classification, 'DIRECT_OHLC'); assert.equal(diagnostic.sampleCount, 2);
  assert.equal(diagnostic.validForSingleOhlcContract, true); assert.equal(diagnostic.rawPayloadIncluded, false);
  assert.equal(JSON.stringify(diagnostic).includes('1.1705'), false);
});

test('documentary FxSpot BidAsk shape is classified but never synthesized into OHLC', () => {
  const sample = { Time: '2026-09-09T11:59:00Z', OpenBid: 1.1, HighBid: 1.2, LowBid: 1.0, CloseBid: 1.15,
    OpenAsk: 1.11, HighAsk: 1.21, LowAsk: 1.01, CloseAsk: 1.16 };
  const chartResponse = { ...payload().chartResponse, Data: [sample] };
  const diagnostic = diagnoseSaxoChartSnapshotStructure(chartResponse);
  assert.equal(diagnostic.classification, 'BID_ASK_OHLC'); assert.equal(diagnostic.validForSingleOhlcContract, false);
  assert.throws(() => transformSaxoChartsOffline({ ...payload(), chartResponse }), /SAXO_OHLC_MALFORMED/);
});

test('structural diagnostic distinguishes missing, empty and incomplete data', () => {
  assert.equal(diagnoseSaxoChartSnapshotStructure({}).classification, 'DATA_MISSING');
  assert.equal(diagnoseSaxoChartSnapshotStructure({ Data: [] }).classification, 'DATA_EMPTY');
  assert.equal(diagnoseSaxoChartSnapshotStructure({ Data: [{ Time: NOW, Open: 1 }] }).classification, 'INCOMPLETE_OR_ALTERNATIVE');
});
