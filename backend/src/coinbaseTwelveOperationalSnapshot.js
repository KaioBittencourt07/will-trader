import { normalizeMarketSnapshot } from '../../data/src/marketAdapter.js';
import { deriveTechnical } from '../../data/src/providers/twelveDataProvider.js';
import { COINBASE_TEMPORAL_PRODUCTS } from './coinbaseTemporalAuthority.js';

export const COINBASE_TWELVE_OPERATIONAL_SNAPSHOT_VERSION = 'coinbase-twelve-operational-snapshot-v2';
export const TWELVE_BAR_OPEN_DOCUMENTATION = 'TWELVE_TIME_SERIES_DATETIME_REFERS_TO_BAR_OPEN';

const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value));

function parseBarOpen(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function intervalMs(timeframe) {
  if (timeframe === '1min') return 60_000;
  return null;
}

function normalizedClosedRows(candles = [], { eventTimestamp, timeframe }) {
  const width = intervalMs(timeframe);
  if (!width) return [];
  return (Array.isArray(candles) ? candles : [])
    .map((bar) => {
      const openMs = parseBarOpen(bar?.datetime ?? bar?.timestamp ?? bar?.time);
      return {
        datetime: openMs === null ? null : new Date(openMs).toISOString(),
        open: finite(bar?.open) ? Number(bar.open) : null,
        high: finite(bar?.high) ? Number(bar.high) : null,
        low: finite(bar?.low) ? Number(bar.low) : null,
        close: finite(bar?.close) ? Number(bar.close) : null,
        volume: finite(bar?.volume) ? Number(bar.volume) : undefined,
        openMs
      };
    })
    .filter((bar) => bar.openMs !== null
      && [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)
      && bar.high >= Math.max(bar.open, bar.close)
      && bar.low <= Math.min(bar.open, bar.close)
      && bar.openMs + width <= eventTimestamp)
    .sort((left, right) => right.openMs - left.openMs);
}

export function composeCoinbaseTwelveOperationalSnapshot({
  twelveSnapshot = {},
  coinbaseHealth = null,
  now = Date.now(),
  requiredBars = 50
} = {}) {
  const reasons = [];
  const authority = coinbaseHealth?.temporalAuthority ?? null;
  const latestTick = coinbaseHealth?.latestTick ?? null;
  const timeframe = String(twelveSnapshot?.timeframe || '').trim();
  const asset = String(twelveSnapshot?.asset || '').trim().toUpperCase();

  if (!COINBASE_TEMPORAL_PRODUCTS[asset]) reasons.push('COMPOSITE_ASSET_NOT_QUALIFIED_CRYPTO');
  if (latestTick?.symbol && String(latestTick.symbol).trim().toUpperCase() !== asset) reasons.push('COINBASE_TICK_SYMBOL_MISMATCH');
  if (timeframe !== '1min') reasons.push('COMPOSITE_TIMEFRAME_UNSUPPORTED');
  if (coinbaseHealth?.ready !== true) reasons.push('COINBASE_TEMPORAL_RUNTIME_NOT_READY');
  if (authority?.authorityGate !== 'PASS' || authority?.freshnessGate !== 'PASS') reasons.push('COINBASE_TEMPORAL_AUTHORITY_NOT_APPROVED');
  if (authority?.timestampAuthority !== 'COINBASE_EXCHANGE_TICKER_MATCH_TIME') reasons.push('COINBASE_TIMESTAMP_AUTHORITY_UNEXPECTED');
  if (Number(authority?.freshnessContractMs) !== 30_000) reasons.push('COINBASE_FRESHNESS_CONTRACT_MISMATCH');
  if (!finite(latestTick?.price) || Number(latestTick.price) <= 0) reasons.push('COINBASE_LATEST_PRICE_INVALID');
  if (!finite(authority?.eventTimestamp)) reasons.push('COINBASE_EVENT_TIME_MISSING');

  const eventTimestamp = finite(authority?.eventTimestamp) ? Number(authority.eventTimestamp) : null;
  const closedRows = eventTimestamp === null ? [] : normalizedClosedRows(twelveSnapshot?.candles, { eventTimestamp, timeframe });
  if (closedRows.length < Number(requiredBars)) reasons.push('TWELVE_CLOSED_BARS_INSUFFICIENT');

  if (reasons.length) {
    return Object.freeze({
      version: COINBASE_TWELVE_OPERATIONAL_SNAPSHOT_VERSION,
      valid: false,
      status: 'INVALID',
      reason: reasons[0],
      reasons: Object.freeze([...new Set(reasons)]),
      asset: asset || null,
      timeframe: timeframe || null,
      authoritativeFreshness: authority,
      ordersExecuted: 0
    });
  }

  const retained = closedRows.slice(0, Math.max(Number(requiredBars), 50));
  const technical = deriveTechnical(retained);
  const latestClosed = retained[0];
  const timestamp = new Date(eventTimestamp).toISOString();
  const normalized = normalizeMarketSnapshot({
    asset,
    timeframe,
    price: Number(latestTick.price),
    timestamp,
    quoteTimestamp: timestamp,
    candleTimestamp: latestClosed.datetime,
    latestCandleTimestamp: latestClosed.datetime,
    latestClosedCandleTimestamp: latestClosed.datetime,
    candles: retained,
    source: 'twelvedata-closed-ohlc+coinbase-exchange-ticker',
    marketOpen: true,
    providerReceivedAt: latestTick.receivedAt,
    quoteAgeMs: Number(now) - eventTimestamp,
    candleAgeMs: Number(now) - Date.parse(latestClosed.datetime),
    candleCompleteness: 'VERIFIED_CLOSED_BY_DOCUMENTED_CHART_CONTEXT',
    candleClosureProof: Object.freeze({
      version: 'twelve-bar-open-temporal-closure-v1',
      documentationSemantic: TWELVE_BAR_OPEN_DOCUMENTATION,
      intervalMs: 60_000,
      rule: 'barOpenTimestamp + interval <= verifiedCoinbaseEventTimestamp',
      authority: authority.timestampAuthority,
      latestClosedCandleTimestamp: latestClosed.datetime
    }),
    freshnessBasis: 'COINBASE_EXCHANGE_TICKER_MATCH_TIME',
    freshnessPolicyVersion: 'cross-provider-event-time-freshness-v1',
    freshnessMaxAgeMs: 30_000,
    timestampOrigins: Object.freeze({
      quoteTimestamp: 'coinbase.exchange.ticker.time',
      candleTimestamp: 'twelvedata.time_series.values[].datetime[documented_bar_open]',
      providerReceivedAt: 'coinbase_runtime_feed_receive_clock'
    }),
    authoritativeFreshness: authority,
    compositeVersion: COINBASE_TWELVE_OPERATIONAL_SNAPSHOT_VERSION,
    ...technical
  }, { maxAgeMs: 30_000, now: Number(now) });

  return Object.freeze({
    ...normalized,
    authoritativeFreshness: authority,
    compositeVersion: COINBASE_TWELVE_OPERATIONAL_SNAPSHOT_VERSION,
    candleCompleteness: 'VERIFIED_CLOSED_BY_DOCUMENTED_CHART_CONTEXT',
    latestClosedCandleTimestamp: latestClosed.datetime,
    candles: Object.freeze(retained.map((bar) => Object.freeze({
      datetime: bar.datetime,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      ...(bar.volume === undefined ? {} : { volume: bar.volume })
    }))),
    candleCount: retained.length,
    decisionImpact: normalized.valid ? 'ANALYSIS_INPUT_ONLY' : 'NONE',
    ordersExecuted: 0
  });
}
