import { observationFromCoinbaseTicker, qualifyCoinbaseTickerSeries, coinbaseProductFor } from './coinbaseTemporalAuthority.js';

const WS_URL = 'wss://ws-feed.exchange.coinbase.com';

function addListener(socket, event, handler) {
  if (typeof socket.addEventListener === 'function') socket.addEventListener(event, handler);
  else socket[`on${event}`] = handler;
}

export function createCoinbaseTemporalFeed({
  enabled = false,
  symbol = 'BTC/USD',
  webSocketFactory = (url) => new WebSocket(url),
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  reconnectMs = 2_000,
  maxObservations = 40
} = {}) {
  const providerProduct = coinbaseProductFor(symbol);
  const observations = [];
  let socket = null;
  let running = false;
  let reconnectTimer = null;
  let state = enabled ? 'IDLE' : 'DISABLED';
  let messagesReceived = 0;
  let acceptedObservations = 0;
  let subscriptionsAccepted = 0;
  let reconnects = 0;
  let lastError = null;

  function pushObservation(observation) {
    observations.push(observation);
    if (observations.length > Math.max(8, Number(maxObservations) || 40)) observations.shift();
    acceptedObservations += 1;
  }

  function scheduleReconnect() {
    if (!running || reconnectTimer) return;
    reconnectTimer = setTimer(() => {
      reconnectTimer = null;
      reconnects += 1;
      connect();
    }, Math.max(500, Number(reconnectMs) || 2_000));
  }

  function connect() {
    if (!running || socket) return;
    state = 'CONNECTING';
    try {
      const candidate = webSocketFactory(WS_URL);
      socket = candidate;
      addListener(candidate, 'open', () => {
        if (socket !== candidate || !running) return;
        state = 'CONNECTED';
        try {
          candidate.send(JSON.stringify({ type: 'subscribe', product_ids: [providerProduct], channels: ['ticker'] }));
        } catch (error) {
          lastError = String(error?.message || 'COINBASE_SUBSCRIBE_SEND_FAILED').slice(0, 200);
        }
      });
      addListener(candidate, 'message', (event) => {
        messagesReceived += 1;
        let payload;
        try {
          payload = JSON.parse(typeof event?.data === 'string' ? event.data : String(event?.data ?? ''));
        } catch {
          return;
        }
        if (payload?.type === 'subscriptions') {
          const ticker = Array.isArray(payload?.channels)
            ? payload.channels.find((channel) => channel?.name === 'ticker' && Array.isArray(channel?.product_ids) && channel.product_ids.includes(providerProduct))
            : null;
          if (ticker) subscriptionsAccepted = 1;
          return;
        }
        if (payload?.type !== 'ticker' || payload?.product_id !== providerProduct) return;
        try {
          pushObservation(observationFromCoinbaseTicker({
            payload,
            receivedAt: new Date(now()).toISOString(),
            canonicalSymbol: symbol
          }));
        } catch (error) {
          lastError = String(error?.message || 'COINBASE_TICKER_PARSE_FAILED').slice(0, 200);
        }
      });
      addListener(candidate, 'error', (error) => {
        lastError = String(error?.message || error?.type || 'COINBASE_WEBSOCKET_ERROR').slice(0, 200);
      });
      addListener(candidate, 'close', () => {
        if (socket !== candidate) return;
        socket = null;
        subscriptionsAccepted = 0;
        state = running ? 'RECONNECTING' : 'STOPPED';
        if (running) scheduleReconnect();
      });
    } catch (error) {
      socket = null;
      lastError = String(error?.message || 'COINBASE_WEBSOCKET_CONSTRUCTOR_FAILED').slice(0, 200);
      state = 'RECONNECTING';
      scheduleReconnect();
    }
  }

  function start() {
    if (!enabled || running) return false;
    running = true;
    connect();
    return true;
  }

  function stop() {
    running = false;
    clearTimer(reconnectTimer);
    reconnectTimer = null;
    const candidate = socket;
    socket = null;
    state = enabled ? 'STOPPED' : 'DISABLED';
    try { candidate?.close?.(); } catch {}
  }

  function health() {
    const checkedAt = now();
    const qualification = qualifyCoinbaseTickerSeries({ observations, now: checkedAt });
    const latest = observations.at(-1) ?? null;
    const authority = qualification.temporalAuthority;
    const ready = qualification.canEvaluateFrozenFreshness === true
      && authority?.authorityGate === 'PASS'
      && authority?.freshnessGate === 'PASS';
    return Object.freeze({
      version: 'coinbase-temporal-runtime-feed-v1',
      mode: 'TEMPORAL_AUTHORITY_ONLY',
      enabled,
      running,
      state,
      symbol,
      providerProduct,
      endpoint: WS_URL,
      channel: 'ticker',
      authenticationRequired: false,
      messagesReceived,
      acceptedObservations,
      retainedObservations: observations.length,
      subscriptionsAccepted,
      reconnects,
      lastError,
      ready,
      latestTick: latest ? Object.freeze({
        symbol: latest.symbol,
        price: latest.price,
        eventTimestamp: latest.eventTimestamp,
        eventTimeRaw: latest.eventTimeRaw,
        receivedAt: latest.receivedAt,
        sequence: latest.sequence,
        tradeId: latest.tradeId
      }) : null,
      qualification,
      temporalAuthority: authority,
      decisionImpact: ready ? 'ALLOW_ANALYSIS_ONLY' : 'NONE',
      ordersExecuted: 0
    });
  }

  return Object.freeze({ start, stop, health });
}
