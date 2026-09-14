import { normalizeMarketSnapshot } from '../../data/src/marketAdapter.js';
import { deriveTechnical } from '../../data/src/providers/twelveDataProvider.js';
import { BIQUOTE_FOREX_PRODUCTS } from './biquoteForexRuntimeFeed.js';

export const BIQUOTE_TWELVE_OPERATIONAL_SNAPSHOT_VERSION = 'biquote-twelve-forex-operational-snapshot-v1';
export const TWELVE_BAR_OPEN_DOCUMENTATION = 'TWELVE_TIME_SERIES_DATETIME_REFERS_TO_BAR_OPEN';

const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value));

function parseBarOpen(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedClosedRows(candles = [], { eventTimestamp, timeframe }) {
  if (timeframe !== '1min') return [];
  const width = 60_000;
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

export function composeBiquoteTwelveOperationalSnapshot({
  twelveSnapshot = {},
  biquoteHealth = null,
  now = Date.now(),
  requiredBars = 50
} = {}) {
  const reasons = [];
  const asset = String(twelveSnapshot?.asset || '').trim().toUpperCase();
  const timeframe = String(twelveSnapshot?.timeframe || '').trim();
  const authority = biquoteHealth?.temporalAuthority ?? null;
  const latestTick = biquoteHealth?.latestTick ?? null;

  if (!BIQUOTE_FOREX_PRODUCTS[asset]) reasons.push('COMPOSITE_ASSET_NOT_QUALIFIED_FOREX');
  if (latestTick?.symbol && String(latestTick.symbol).trim().toUpperCase() !== asset) reasons.push('BIQUOTE_TICK_SYMBOL_MISMATCH');
  if (timeframe !== '1min') reasons.push('COMPOSITE_TIMEFRAME_UNSUPPORTED');
  if (biquoteHealth?.ready !== true) reasons.push('BIQUOTE_TEMPORAL_RUNTIME_NOT_READY');
  if (authority?.authorityGate !== 'PASS' || authority?.freshnessGate !== 'PASS') reasons.push('BIQUOTE_TEMPORAL_AUTHORITY_NOT_APPROVED');
  if (authority?.timestampAuthority !== 'BIQUOTE_API_LATEST_TICK_TIMESTAMP') reasons.push('BIQUOTE_TIMESTAMP_AUTHORITY_UNEXPECTED');
  if (Number(authority?.freshnessContractMs) !== 30_000) reasons.push('BIQUOTE_FRESHNESS_CONTRACT_MISMATCH');
  if (!finite(latestTick?.price) || Number(latestTick.price) <= 0) reasons.push('BIQUOTE_LATEST_PRICE_INVALID');
  if (!finite(authority?.eventTimestamp)) reasons.push('BIQUOTE_EVENT_TIME_MISSING');

  const eventTimestamp = finite(authority?.eventTimestamp) ? Number(authority.eventTimestamp) : null;
  const closedRows = eventTimestamp === null ? [] : normalizedClosedRows(twelveSnapshot?.candles, { eventTimestamp, timeframe });
  if (closedRows.length < Number(requiredBars)) reasons.push('TWELVE_CLOSED_BARS_INSUFFICIENT');

  if (reasons.length) {
    return Object.freeze({
      version: BIQUOTE_TWELVE_OPERATIONAL_SNAPSHOT_VERSION,
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
  const latestClosed = retained[0];
  const technical = deriveTechnical(retained);
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
    source: 'twelvedata-closed-ohlc+biquote-forex-tick',
    marketOpen: true,
    providerReceivedAt: latestTick.receivedAt,
    quoteAgeMs: Number(now) - eventTimestamp,
    candleAgeMs: Number(now) - Date.parse(latestClosed.datetime),
    candleCompleteness: 'VERIFIED_CLOSED_BY_BIQUOTE_EVENT_TIME',
    candleClosureProof: Object.freeze({
      version: 'twelve-bar-open-biquote-temporal-closure-v1',
      documentationSemantic: TWELVE_BAR_OPEN_DOCUMENTATION,
      intervalMs: 60_000,
      rule: 'barOpenTimestamp + interval <= verifiedBiquoteEventTimestamp',
      authority: authority.timestampAuthority,
      latestClosedCandleTimestamp: latestClosed.datetime
    }),
    freshnessBasis: 'BIQUOTE_API_LATEST_TICK_TIMESTAMP',
    freshnessPolicyVersion: 'cross-provider-event-time-freshness-v1',
    freshnessMaxAgeMs: 30_000,
    timestampOrigins: Object.freeze({
      quoteTimestamp: 'biquote.api.latest.timestamp',
      candleTimestamp: 'twelvedata.time_series.values[].datetime[documented_bar_open]',
      providerReceivedAt: 'biquote_runtime_receive_clock'
    }),
    authoritativeFreshness: authority,
    compositeVersion: BIQUOTE_TWELVE_OPERATIONAL_SNAPSHOT_VERSION,
    compositeProvider: 'BIQUOTE',
    ...technical
  }, { maxAgeMs: 30_000, now: Number(now) });

  return Object.freeze({
    ...normalized,
    authoritativeFreshness: authority,
    compositeVersion: BIQUOTE_TWELVE_OPERATIONAL_SNAPSHOT_VERSION,
    compositeProvider: 'BIQUOTE',
    candleCompleteness: 'VERIFIED_CLOSED_BY_BIQUOTE_EVENT_TIME',
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
