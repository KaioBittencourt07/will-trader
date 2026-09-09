export const SAXO_QUALIFICATION_VERSION = 'saxo-openapi-charts-offline-qualification-v1';
export const SAXO_QUALIFICATION = Object.freeze({
  provider: 'saxo-openapi-charts', status: 'QUALIFIED_OFFLINE_WITH_LIMITATIONS', liveEligibility: 'EXTERNAL_UNVERIFIED',
  canonicalSymbol: 'EUR/USD', providerSymbol: 'EURUSD', uic: 21, assetType: 'FxSpot', willTimeframe: '1min', horizon: 1,
  quoteFreshness: 'UNVERIFIED_CHART_HAS_NO_INDEPENDENT_QUOTE_TIMESTAMP', enabledByDefault: false
});

const numeric = (value) => value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
function fail(code) { const error = new Error(code); error.code = code; throw error; }

export function classifySaxoFailure(error) {
  const status = Number(error?.status);
  if (status === 401 || status === 403) return 'MISCONFIGURED';
  if (status === 429) return 'RATE_LIMITED';
  return 'UNAVAILABLE';
}

function mapSample(sample) {
  const mapped = {
    datetime: sample?.Time,
    open: numeric(sample?.Open), high: numeric(sample?.High), low: numeric(sample?.Low), close: numeric(sample?.Close)
  };
  if (!Number.isFinite(Date.parse(mapped.datetime ?? '')) ||
      [mapped.open, mapped.high, mapped.low, mapped.close].some((value) => value === null) ||
      mapped.low > mapped.high || mapped.open < mapped.low || mapped.open > mapped.high ||
      mapped.close < mapped.low || mapped.close > mapped.high) fail('SAXO_OHLC_MALFORMED');
  return mapped;
}

export function transformSaxoChartsOffline({
  chartResponse,
  sampleEvidence,
  canonicalSymbol = 'EUR/USD', providerSymbol = 'EURUSD', uic = 21, assetType = 'FxSpot',
  timeframe = '1min', horizon = 1, receivedAt, maxAgeMs = 30_000
} = {}) {
  if (canonicalSymbol !== 'EUR/USD' || providerSymbol !== 'EURUSD' || uic !== 21 || assetType !== 'FxSpot') fail('SAXO_SYMBOL_MAPPING_MISMATCH');
  if (timeframe !== '1min' || horizon !== 1) fail('SAXO_TIMEFRAME_MAPPING_MISMATCH');
  if (maxAgeMs !== 30_000) fail('SAXO_FRESHNESS_GATE_FROZEN');
  const receivedAtMs = Date.parse(receivedAt ?? '');
  if (!Number.isFinite(receivedAtMs)) fail('SAXO_PROVIDER_RECEIVED_AT_MISSING');
  if (chartResponse?.ChartInfo?.Horizon !== 1) fail('SAXO_RESPONSE_TIMEFRAME_MISMATCH');
  if (!Number.isInteger(chartResponse?.DataVersion)) fail('SAXO_DATA_VERSION_MISSING');
  if (!Number.isFinite(Date.parse(chartResponse?.ChartInfo?.FirstSampleTime ?? ''))) fail('SAXO_FIRST_SAMPLE_TIME_MISSING');
  if (!Array.isArray(chartResponse?.Data) || !chartResponse.Data.length) fail('SAXO_OHLC_MISSING');

  const samples = chartResponse.Data.map(mapSample).sort((left, right) => Date.parse(right.datetime) - Date.parse(left.datetime));
  let closedSamples;
  let currentSample = null;
  let completenessRule;
  if (sampleEvidence === 'SUBSCRIPTION_INITIAL_SNAPSHOT') {
    closedSamples = samples;
    completenessRule = 'PROVIDER_DOCUMENTED_INITIAL_SNAPSHOT_COMPLETED_SAMPLES';
  } else if (sampleEvidence === 'STREAM_UPDATE_CLOSED_AND_OPENED') {
    if (samples.length !== 2 || Date.parse(samples[0].datetime) === Date.parse(samples[1].datetime)) fail('SAXO_STREAM_COMPLETENESS_AMBIGUOUS');
    currentSample = samples[0];
    closedSamples = [samples[1]];
    completenessRule = 'SAME_UPDATE_NOW_CLOSED_PLUS_JUST_OPENED_SAMPLE';
  } else {
    fail('SAXO_SAMPLE_COMPLETENESS_UNVERIFIED');
  }

  const latestClosed = closedSamples[0];
  return {
    asset: providerSymbol,
    canonicalSymbol,
    providerSymbol,
    uic,
    assetType,
    timeframe,
    horizon,
    price: latestClosed.close,
    timestamp: null,
    quoteTimestamp: null,
    quoteAgeMs: null,
    candleTimestamp: latestClosed.datetime,
    latestCandleTimestamp: (currentSample ?? latestClosed).datetime,
    latestClosedCandleTimestamp: latestClosed.datetime,
    candles: closedSamples,
    currentSample,
    source: 'saxo-openapi-charts',
    providerReceivedAt: new Date(receivedAtMs).toISOString(),
    status: 'INVALID',
    valid: false,
    reason: 'QUOTE_FRESHNESS_UNVERIFIED',
    candleCompleteness: 'VERIFIED_CLOSED_BY_DOCUMENTED_CHART_CONTEXT',
    completenessRule,
    freshnessBasis: 'INDEPENDENT_QUOTE_TIMESTAMP_REQUIRED_BUT_ABSENT',
    freshnessPolicyVersion: 'rest-quote-freshness-v1',
    freshnessMaxAgeMs: 30_000,
    dataVersion: chartResponse.DataVersion,
    delayedByMinutes: chartResponse.ChartInfo.DelayedByMinutes ?? null,
    firstSampleTime: chartResponse.ChartInfo.FirstSampleTime,
    qualificationVersion: SAXO_QUALIFICATION_VERSION,
    timestampOrigins: {
      quoteTimestamp: 'NOT_AVAILABLE_IN_SAXO_CHART_RESPONSE',
      candleTimestamp: 'saxo.chart.v3.response.Data[].Time',
      providerReceivedAt: 'will.local_clock_after_offline_payload_parse',
      firstSampleTime: 'saxo.chart.v3.response.ChartInfo.FirstSampleTime'
    }
  };
}

