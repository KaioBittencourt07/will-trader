const WS_URL = 'wss://ws.twelvedata.com/v1/quotes/price';

function normalizeSymbols(symbols) {
  return [...new Set((Array.isArray(symbols) ? symbols : String(symbols || '').split(','))
    .map((symbol) => String(symbol).trim().toUpperCase())
    .filter(Boolean))];
}

function eventTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function addListener(socket, event, handler) {
  if (typeof socket.addEventListener === 'function') socket.addEventListener(event, handler);
  else socket[`on${event}`] = handler;
}

export function createTwelveWebSocketFeed({
  apiKey,
  symbols = [],
  enabled = false,
  webSocketFactory = (url) => new WebSocket(url),
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  heartbeatMs = 10_000,
  staleAfterMs = 30_000,
  gapAfterMs = 15_000,
  reconnectBaseMs = 1_000,
  reconnectMaxMs = 30_000,
  logger = () => {}
} = {}) {
  const configuredSymbols = normalizeSymbols(symbols);
  const latestTicks = new Map();
  const metrics = {
    messagesReceived: 0,
    ticksAccepted: 0,
    duplicates: 0,
    gaps: 0,
    reconnects: 0,
    heartbeatSent: 0,
    connectionAttempts: 0,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    lastMessageAt: null,
    lastError: null
  };
  let socket = null;
  let heartbeatTimer = null;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let running = false;
  let state = enabled ? 'IDLE' : 'DISABLED';

  function socketOpen(candidate = socket) {
    return candidate && (candidate.readyState === 1 || candidate.readyState === candidate.OPEN);
  }

  function send(payload) {
    if (!socketOpen()) return false;
    socket.send(JSON.stringify(payload));
    return true;
  }

  function scheduleHeartbeat() {
    clearTimer(heartbeatTimer);
    if (!running || !socketOpen()) return;
    heartbeatTimer = setTimer(() => {
      if (send({ action: 'heartbeat' })) metrics.heartbeatSent += 1;
      scheduleHeartbeat();
    }, heartbeatMs);
  }

  function scheduleReconnect() {
    if (!running || reconnectTimer) return;
    const delay = Math.min(reconnectMaxMs, reconnectBaseMs * (2 ** reconnectAttempt));
    reconnectAttempt += 1;
    metrics.reconnects += 1;
    state = 'RECONNECTING';
    reconnectTimer = setTimer(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function handleMessage(event) {
    metrics.messagesReceived += 1;
    metrics.lastMessageAt = new Date(now()).toISOString();
    let payload;
    try {
      payload = JSON.parse(typeof event?.data === 'string' ? event.data : String(event?.data ?? ''));
    } catch {
      return;
    }
    if (payload?.event !== 'price') return;
    const symbol = String(payload.symbol || '').trim().toUpperCase();
    if (!configuredSymbols.includes(symbol)) return;
    const receivedAt = now();
    const timestamp = eventTimestamp(payload.timestamp);
    const price = Number(payload.price);
    if (!Number.isFinite(price) || timestamp === null) return;
    const previous = latestTicks.get(symbol);
    const fingerprint = `${timestamp}|${price}`;
    if (previous?.fingerprint === fingerprint) {
      metrics.duplicates += 1;
      return;
    }
    if (previous && timestamp - previous.eventTimestamp > gapAfterMs) metrics.gaps += 1;
    latestTicks.set(symbol, { symbol, price, eventTimestamp: timestamp, receivedAt, fingerprint });
    metrics.ticksAccepted += 1;
  }

  function connect() {
    if (!running || socket) return;
    state = 'CONNECTING';
    metrics.connectionAttempts += 1;
    const url = `${WS_URL}?apikey=${encodeURIComponent(apiKey)}`;
    try {
      const candidate = webSocketFactory(url);
      socket = candidate;
      addListener(candidate, 'open', () => {
        if (socket !== candidate || !running) return;
        state = 'CONNECTED';
        reconnectAttempt = 0;
        metrics.lastConnectedAt = new Date(now()).toISOString();
        send({ action: 'subscribe', params: { symbols: configuredSymbols.join(',') } });
        scheduleHeartbeat();
      });
      addListener(candidate, 'message', handleMessage);
      addListener(candidate, 'error', (error) => {
        metrics.lastError = String(error?.message || 'WEBSOCKET_ERROR').slice(0, 200);
      });
      addListener(candidate, 'close', () => {
        if (socket !== candidate) return;
        socket = null;
        clearTimer(heartbeatTimer);
        heartbeatTimer = null;
        metrics.lastDisconnectedAt = new Date(now()).toISOString();
        if (running) scheduleReconnect();
        else state = 'STOPPED';
      });
    } catch (error) {
      socket = null;
      metrics.lastError = String(error?.message || error).slice(0, 200);
      scheduleReconnect();
    }
  }

  function start() {
    if (!enabled || running) return false;
    if (!apiKey) throw new Error('TWELVEDATA_API_KEY é obrigatória para habilitar o WebSocket.');
    if (!configuredSymbols.length) throw new Error('Ao menos um símbolo WebSocket é obrigatório.');
    running = true;
    connect();
    return true;
  }

  function stop() {
    running = false;
    state = enabled ? 'STOPPED' : 'DISABLED';
    clearTimer(heartbeatTimer);
    clearTimer(reconnectTimer);
    heartbeatTimer = null;
    reconnectTimer = null;
    const candidate = socket;
    socket = null;
    if (candidate && typeof candidate.close === 'function') candidate.close();
  }

  function health() {
    const checkedAt = now();
    const ticks = configuredSymbols.map((symbol) => {
      const tick = latestTicks.get(symbol);
      const ageMs = tick ? Math.max(0, checkedAt - tick.receivedAt, checkedAt - tick.eventTimestamp) : null;
      return {
        symbol,
        eventTimestamp: tick?.eventTimestamp ?? null,
        receivedAt: tick ? new Date(tick.receivedAt).toISOString() : null,
        ageMs,
        fresh: Boolean(tick && ageMs <= staleAfterMs)
      };
    });
    const freshSymbols = ticks.filter((tick) => tick.fresh).length;
    const tickAges = ticks.filter((tick) => tick.ageMs !== null).map((tick) => tick.ageMs);
    return {
      mode: 'SHADOW_OBSERVABILITY',
      state,
      enabled,
      connected: state === 'CONNECTED',
      available: state === 'CONNECTED' && freshSymbols > 0,
      configuredSymbols: configuredSymbols.length,
      activeSymbols: state === 'CONNECTED' ? configuredSymbols.length : 0,
      staleAfterMs,
      ...metrics,
      lastTickAgeMs: tickAges.length ? Math.min(...tickAges) : null,
      symbols: ticks,
      restReductionPotential: {
        observationalOnly: true,
        freshSymbols,
        requestsAvoided: 0
      },
      authoritativeCandlesBuilt: 0,
      decisionImpact: 'NONE'
    };
  }

  return { start, stop, health };
}
