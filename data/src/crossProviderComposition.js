export const CROSS_PROVIDER_COMPOSITION_VERSION = 'saxo-closed-ohlc-independent-quote-v1';
export const BID_ASK_COMPOSITION_VERSION = 'saxo-closed-bid-ask-ohlc-independent-quote-v1';

const validTime = (value) => Number.isFinite(Date.parse(value ?? ''));
const canonical = (value) => String(value || '').trim().toUpperCase();
const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value));

function invalid(reasonCodes, evidence = {}) {
  return Object.freeze({
    compositionVersion: CROSS_PROVIDER_COMPOSITION_VERSION,
    compositionState: 'INVALID', status: 'INVALID', valid: false,
    decisionImpact: 'NONE', reason: reasonCodes[0], reasonCodes: [...new Set(reasonCodes)], ...evidence
  });
}

export function composeSaxoBidAskIndependentQuote({ saxoSnapshot, quoteHealth, canonicalSymbol = 'EUR/USD',
  timeframe = '1min', now = Date.now(), maxAgeMs = 30_000 } = {}) {
  const reasons = [];
  const symbol = canonical(canonicalSymbol);
  if (maxAgeMs !== 30_000) reasons.push('FRESHNESS_GATE_FROZEN');
  if (symbol !== 'EUR/USD' || timeframe !== '1min') reasons.push('CANONICAL_MAPPING_MISMATCH');
  if (saxoSnapshot?.contractVersion !== 'bid-ask-ohlc-v1' || saxoSnapshot?.providerEvidenceValid !== true ||
      saxoSnapshot?.marketDataRepresentation !== 'BID_ASK_OHLC') reasons.push('SAXO_BID_ASK_EVIDENCE_INVALID');
  if (saxoSnapshot?.championCompatible !== false || saxoSnapshot?.midpoint !== null || saxoSnapshot?.selectedSide !== null) reasons.push('BID_ASK_SEMANTIC_SEPARATION_INVALID');
  if (saxoSnapshot?.candleCompleteness !== 'VERIFIED_CLOSED_BY_DOCUMENTED_CHART_CONTEXT' || !validTime(saxoSnapshot?.latestClosedCandleTimestamp)) reasons.push('SAXO_CLOSED_CANDLE_UNVERIFIED');
  const quote = quoteHealth?.symbols?.find((entry) => canonical(entry?.symbol) === symbol) ?? null;
  const eventTimestamp = finite(quote?.eventTimestamp) ? Number(quote.eventTimestamp) : null;
  const quoteAgeMs = eventTimestamp === null ? null : Number(now) - eventTimestamp;
  if (quoteHealth?.mode !== 'SHADOW_OBSERVABILITY') reasons.push('QUOTE_MODE_UNEXPECTED');
  if (quoteHealth?.connected !== true || Number(quoteHealth?.subscriptionsAccepted || 0) !== 1) reasons.push('QUOTE_SOURCE_NOT_READY');
  if (Number(quoteHealth?.subscriptionsRejected || 0) !== 0 || canonical(quote?.symbol) !== symbol) reasons.push('QUOTE_SUBSCRIPTION_INVALID');
  if (!validTime(quote?.receivedAt)) reasons.push('QUOTE_RECEIVE_TIMESTAMP_INVALID');
  if (!finite(quote?.price) || eventTimestamp === null || quoteAgeMs < -1_000 || quoteAgeMs > 30_000) reasons.push('QUOTE_FRESHNESS_INVALID');
  const evidence = { compositionVersion: BID_ASK_COMPOSITION_VERSION, providerEvidenceValid: reasons.length === 0,
    marketDataRepresentation: 'BID_ASK_OHLC_PLUS_INDEPENDENT_QUOTE', championCompatible: false,
    valid: false, decisionImpact: 'NONE', prospectivePaperAuthorized: false, ordersExecuted: 0,
    quoteTimestamp: eventTimestamp === null ? null : new Date(eventTimestamp).toISOString(), quoteAgeMs,
    latestClosedCandleTimestamp: saxoSnapshot?.latestClosedCandleTimestamp ?? null,
    bidAskCandles: saxoSnapshot?.candles ?? [], midpoint: null, selectedSide: null,
    separation: { quoteProviderDeclaresCandleClosed: false, ohlcProviderDeclaresQuoteFresh: false,
      representationConversion: false, midpointCreated: false, selectedSide: false, championBypass: false },
    reasonCodes: [...new Set(reasons)] };
  return Object.freeze({ ...evidence, compositionState: reasons.length ? 'INVALID' : 'PROVIDER_EVIDENCE_COMPOSABLE_OFFLINE',
    status: reasons.length ? 'INVALID' : 'OFFLINE_PROVIDER_EVIDENCE_ONLY', reason: reasons[0] ?? 'CHAMPION_CONSUMER_NOT_AUTHORIZED' });
}

export function composeSaxoClosedOhlcIndependentQuote({
  saxoSnapshot, quoteHealth, canonicalSymbol = 'EUR/USD', timeframe = '1min', now = Date.now(), maxAgeMs = 30_000
} = {}) {
  if (maxAgeMs !== 30_000) return invalid(['FRESHNESS_GATE_FROZEN']);
  const reasons = [];
  const symbol = canonical(canonicalSymbol);
  if (symbol !== 'EUR/USD') reasons.push('CANONICAL_SYMBOL_UNSUPPORTED');
  if (timeframe !== '1min') reasons.push('TIMEFRAME_MISMATCH');

  if (!saxoSnapshot || typeof saxoSnapshot !== 'object') reasons.push('SAXO_OHLC_MISSING');
  else {
    if (saxoSnapshot.source !== 'saxo-openapi-charts') reasons.push('OHLC_PROVIDER_MISMATCH');
    if (canonical(saxoSnapshot.canonicalSymbol) !== symbol || saxoSnapshot.providerSymbol !== 'EURUSD') reasons.push('SAXO_SYMBOL_MISMATCH');
    if (saxoSnapshot.timeframe !== timeframe || saxoSnapshot.horizon !== 1) reasons.push('SAXO_TIMEFRAME_MISMATCH');
    if (saxoSnapshot.candleCompleteness !== 'VERIFIED_CLOSED_BY_DOCUMENTED_CHART_CONTEXT' ||
        !['PROVIDER_DOCUMENTED_INITIAL_SNAPSHOT_COMPLETED_SAMPLES', 'SAME_UPDATE_NOW_CLOSED_PLUS_JUST_OPENED_SAMPLE'].includes(saxoSnapshot.completenessRule)) reasons.push('SAXO_CLOSED_CANDLE_UNVERIFIED');
    if (!validTime(saxoSnapshot.latestClosedCandleTimestamp)) reasons.push('SAXO_CLOSED_TIMESTAMP_INVALID');
    if (!Array.isArray(saxoSnapshot.candles) || !saxoSnapshot.candles.length ||
        !saxoSnapshot.candles.every((bar) => ['open', 'high', 'low', 'close'].every((key) => finite(bar?.[key])))) reasons.push('SAXO_OHLC_INVALID');
    if (!saxoSnapshot.timestampOrigins?.candleTimestamp) reasons.push('SAXO_PROVENANCE_INSUFFICIENT');
  }

  const quote = quoteHealth?.symbols?.find((entry) => canonical(entry?.symbol) === symbol)
    ?? quoteHealth?.symbols?.[0]
    ?? null;
  const eventTimestamp = finite(quote?.eventTimestamp) ? Number(quote.eventTimestamp) : null;
  const quoteTimestamp = eventTimestamp === null ? null : new Date(eventTimestamp).toISOString();
  const quoteAgeMs = eventTimestamp === null ? null : Number(now) - eventTimestamp;
  const receivedAt = quote?.receivedAt ?? null;
  if (!quoteHealth || typeof quoteHealth !== 'object') reasons.push('QUOTE_SOURCE_MISSING');
  else {
    if (quoteHealth.mode !== 'SHADOW_OBSERVABILITY') reasons.push('QUOTE_MODE_UNEXPECTED');
    if (quoteHealth.connected !== true) reasons.push('QUOTE_SOURCE_DISCONNECTED');
    if (Number(quoteHealth.subscriptionsAccepted || 0) < 1 || Number(quoteHealth.subscriptionsRejected || 0) > 0) reasons.push('QUOTE_SUBSCRIPTION_INVALID');
    if (!quote) reasons.push('QUOTE_SYMBOL_MISSING');
    if (quote && canonical(quote.symbol) !== symbol) reasons.push('QUOTE_SYMBOL_MISMATCH');
    if (!finite(quote?.price) || Number(quote.price) <= 0) reasons.push('QUOTE_PRICE_INVALID');
    if (eventTimestamp === null || !validTime(receivedAt)) reasons.push('QUOTE_TIMESTAMP_INVALID');
    if (quoteAgeMs !== null && quoteAgeMs < -1_000) reasons.push('QUOTE_TIMESTAMP_FUTURE');
    if (quoteAgeMs !== null && quoteAgeMs > 30_000) reasons.push('QUOTE_STALE');
  }

  const evidence = {
    providerEvidenceValid: reasons.length === 0,
    marketDataRepresentation: 'DIRECT_OHLC_PLUS_INDEPENDENT_QUOTE',
    championCompatible: true,
    canonicalSymbol: symbol,
    timeframe,
    freshnessMaxAgeMs: 30_000,
    quoteTimestamp,
    quoteAgeMs,
    latestClosedCandleTimestamp: saxoSnapshot?.latestClosedCandleTimestamp ?? null,
    price: finite(quote?.price) ? Number(quote.price) : null,
    candles: Array.isArray(saxoSnapshot?.candles) ? saxoSnapshot.candles : [],
    providers: {
      quote: { id: 'twelvedata-websocket', role: 'QUOTE_FRESHNESS_ONLY', eventTimestamp: quoteTimestamp, receivedAt },
      ohlc: { id: 'saxo-openapi-charts', role: 'OHLC_CLOSED_ONLY', providerSymbol: saxoSnapshot?.providerSymbol ?? null }
    },
    timestampOrigins: {
      quoteTimestamp: 'twelvedata.websocket.price.timestamp',
      quoteReceivedAt: 'will.local_clock_when_ws_event_received_non_authoritative',
      latestClosedCandleTimestamp: saxoSnapshot?.timestampOrigins?.candleTimestamp ?? null
    },
    separation: { quoteProviderDeclaresCandleClosed: false, ohlcProviderDeclaresQuoteFresh: false,
      mixedOhlc: false, timestampSubstitution: false, championBypass: false },
    offlineOnly: true,
    prospectivePaperAuthorized: false
  };
  if (reasons.length) return invalid(reasons, evidence);
  return Object.freeze({
    compositionVersion: CROSS_PROVIDER_COMPOSITION_VERSION,
    compositionState: 'COMPOSABLE_OFFLINE', status: 'OFFLINE_QUALIFIED', valid: false,
    decisionImpact: 'NONE', reason: 'OFFLINE_ONLY_NOT_DECISION_AUTHORIZED', reasonCodes: [], ...evidence
  });
}
