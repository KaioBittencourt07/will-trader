export const WS_REST_COMPOSITION_VERSION = 'ws-freshness-rest-ohlc-composition-v1';

const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const validTime = (value) => Number.isFinite(Date.parse(value ?? ''));
const canonical = (value) => String(value || '').trim().toUpperCase();

function resultBase({ restSnapshot, wsHealth, canonicalSymbol, timeframe, now }) {
  const symbol = canonical(canonicalSymbol || restSnapshot?.asset);
  const wsSymbol = wsHealth?.symbols?.find((entry) => canonical(entry?.symbol) === symbol)
    ?? wsHealth?.symbols?.[0]
    ?? null;
  const restPrice = Number(restSnapshot?.price);
  const wsPrice = Number(wsSymbol?.price);
  const restQuoteTimestamp = restSnapshot?.quoteTimestamp ?? restSnapshot?.timestamp ?? null;
  const candleTimestamp = restSnapshot?.latestCandleTimestamp ?? restSnapshot?.candleTimestamp ?? null;
  const wsEventTimestamp = finite(wsSymbol?.eventTimestamp) ? Number(wsSymbol.eventTimestamp) : null;
  const wsReceivedAt = wsSymbol?.receivedAt ?? null;
  const wsEventAgeMs = wsEventTimestamp === null ? null : now - wsEventTimestamp;
  const wsReceiveAgeMs = validTime(wsReceivedAt) ? now - Date.parse(wsReceivedAt) : null;
  const wsTickAgeMs = wsEventAgeMs === null || wsReceiveAgeMs === null
    ? null
    : wsEventAgeMs >= wsReceiveAgeMs ? wsEventAgeMs : wsReceiveAgeMs;
  const divergenceMeasurable = finite(restPrice) && Number(restPrice) > 0 && finite(wsPrice) && Number(wsPrice) > 0;
  const signed = divergenceMeasurable ? wsPrice - restPrice : null;
  const quoteAgeMs = finite(restSnapshot?.quoteAgeMs ?? restSnapshot?.ageMs) ? Number(restSnapshot.quoteAgeMs ?? restSnapshot.ageMs) : null;
  const restQuoteFresh = quoteAgeMs !== null && quoteAgeMs >= -1_000
    && quoteAgeMs <= Number(restSnapshot?.freshnessMaxAgeMs ?? 30_000);
  const restOhlcAvailable = Array.isArray(restSnapshot?.candles) && restSnapshot.candles.length > 0 && validTime(candleTimestamp);
  const restOhlcAdequacy = !restOhlcAvailable ? 'UNAVAILABLE'
    : restSnapshot?.candleCompleteness === 'VERIFIED_CLOSED' ? 'VERIFIED_CLOSED' : 'OBSERVATIONAL_UNVERIFIED';
  const wsQuoteFresh = wsTickAgeMs !== null && wsTickAgeMs >= -1_000
    && wsTickAgeMs <= Number(wsHealth?.staleAfterMs ?? 30_000);
  return {
    compositionPolicyVersion: WS_REST_COMPOSITION_VERSION,
    compositionMode: 'SHADOW',
    decisionImpact: 'NONE',
    canonicalSymbol: symbol,
    timeframe: String(timeframe || restSnapshot?.timeframe || ''),
    rest: {
      provider: restSnapshot?.source ?? null,
      quoteTimestamp: restQuoteTimestamp,
      quoteAgeMs,
      quoteFresh: restQuoteFresh,
      latestCandleTimestamp: candleTimestamp,
      candleAgeMs: finite(restSnapshot?.candleAgeMs) ? Number(restSnapshot.candleAgeMs) : null,
      candleCompleteness: restSnapshot?.candleCompleteness ?? 'UNVERIFIED',
      ohlcAvailable: restOhlcAvailable,
      ohlcAdequacy: restOhlcAdequacy,
      cacheAgeMs: finite(restSnapshot?.cacheAgeMs) ? Number(restSnapshot.cacheAgeMs) : null,
      freshnessPolicyVersion: restSnapshot?.freshnessPolicyVersion ?? null,
      authoritativeStatus: restSnapshot?.status ?? null,
      authoritativeReason: restSnapshot?.reason ?? null,
      authoritativeValid: restSnapshot?.valid === true,
      price: finite(restPrice) ? restPrice : null
    },
    ws: {
      provider: 'twelvedata',
      mode: wsHealth?.mode ?? null,
      connected: wsHealth?.connected === true,
      subscriptionAccepted: Number(wsHealth?.subscriptionsAccepted || 0) > 0,
      subscriptionRejected: Number(wsHealth?.subscriptionsRejected || 0) > 0,
      symbol: wsSymbol?.symbol ?? null,
      eventTimestamp: wsEventTimestamp,
      receivedAt: wsReceivedAt,
      eventAgeMs: wsEventAgeMs,
      receiveAgeMs: wsReceiveAgeMs,
      wsTickAgeMs,
      tickFresh: wsQuoteFresh,
      price: finite(wsPrice) ? wsPrice : null
    },
    restQuoteFresh,
    wsQuoteFresh,
    restOhlcAvailable,
    restOhlcAdequacy,
    priceDivergence: {
      measurable: divergenceMeasurable,
      signedAbsolute: signed,
      absolute: signed === null ? null : Math.abs(signed),
      relative: signed === null ? null : signed / restPrice,
      basisPoints: signed === null ? null : (signed / restPrice) * 10_000,
      basis: 'WS_LAST_TICK_MINUS_REST_QUOTE',
      authoritativePriceChanged: false
    },
    authoritativeDecision: {
      valid: restSnapshot?.valid === true,
      status: restSnapshot?.status ?? null,
      reason: restSnapshot?.reason ?? null,
      freshnessPolicyVersion: restSnapshot?.freshnessPolicyVersion ?? null
    }
  };
}

export function composeWsFreshnessRestOhlc({
  restSnapshot,
  wsHealth,
  canonicalSymbol,
  timeframe,
  now = Date.now(),
  requireClosedCandle = false,
  futureToleranceMs = 1_000
} = {}) {
  const output = resultBase({ restSnapshot, wsHealth, canonicalSymbol, timeframe, now });
  const reasons = [];
  let state = 'COMPOSABLE';
  const unknown = (reason) => { reasons.push(reason); state = 'UNKNOWN'; };
  const reject = (reason) => { reasons.push(reason); if (state !== 'UNKNOWN') state = 'NOT_COMPOSABLE'; };

  if (!restSnapshot || typeof restSnapshot !== 'object') unknown('REST_SNAPSHOT_MISSING');
  else {
    if (restSnapshot.source !== 'twelvedata') unknown('REST_PROVIDER_MISMATCH');
    if (restSnapshot.freshnessPolicyVersion !== 'rest-quote-freshness-v1' || !restSnapshot.timestampOrigins) unknown('REST_CACHE_PROVENANCE_INSUFFICIENT');
    if (!validTime(output.rest.quoteTimestamp)) unknown('REST_QUOTE_TIMESTAMP_INVALID');
    if (!output.rest.ohlcAvailable || !validTime(output.rest.latestCandleTimestamp)) reject('REST_OHLC_UNAVAILABLE');
    if (requireClosedCandle && output.rest.candleCompleteness !== 'VERIFIED_CLOSED') reject('CANDLE_COMPLETENESS_UNVERIFIED');
  }

  if (!wsHealth || typeof wsHealth !== 'object') unknown('WS_HEALTH_MISSING');
  else {
    if (wsHealth.mode !== 'SHADOW_OBSERVABILITY') unknown('WS_MODE_UNEXPECTED');
    if (!output.ws.connected) reject('WS_DISCONNECTED');
    if (output.ws.subscriptionRejected) reject('WS_SUBSCRIPTION_REJECTED');
    if (!output.ws.subscriptionAccepted) reject('WS_SUBSCRIPTION_NOT_ACCEPTED');
    if (!output.ws.symbol) reject('WS_TICK_MISSING');
    if (output.ws.symbol && canonical(output.ws.symbol) !== output.canonicalSymbol) reject('WS_SYMBOL_MISMATCH');
    if (output.ws.eventTimestamp === null || !validTime(output.ws.receivedAt)) reject('WS_TIMESTAMP_INVALID');
    if (output.ws.eventAgeMs !== null && output.ws.eventAgeMs < -Math.abs(futureToleranceMs)) reject('WS_TIMESTAMP_FUTURE');
    if (!output.ws.tickFresh) reject('WS_TICK_STALE');
  }

  if (!output.priceDivergence.measurable) reject('PRICE_DIVERGENCE_NOT_MEASURABLE');
  if (state === 'COMPOSABLE' && !output.rest.quoteFresh) reasons.push('REST_QUOTE_STALE_SHADOW_ONLY');
  if (state === 'COMPOSABLE' && output.rest.candleCompleteness !== 'VERIFIED_CLOSED') reasons.push('CANDLE_COMPLETENESS_UNVERIFIED_OBSERVATIONAL');

  return Object.freeze({
    ...output,
    compositionState: state,
    reasonCodes: [...new Set(reasons)],
    composableDoesNotAuthorizeDecision: true
  });
}
