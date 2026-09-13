import { classifyPreOpenHandshakeFailure } from './twelveHandshakeAnalysis.js';

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

function sanitizedDetail(value) {
  return String(value || '')
    .replace(/([?&]apikey=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\b(api[_-]?key|token|authorization)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, 200);
}

function transportDiagnostic(error, phase) {
  const nested = error?.error ?? error?.cause ?? null;
  const rawCode = error?.code ?? nested?.code ?? nested?.cause?.code ?? null;
  const code = /^[A-Z0-9_]{2,60}$/.test(String(rawCode || '')) ? String(rawCode) : null;
  const detail = sanitizedDetail(error?.message || nested?.message || error?.type || 'WEBSOCKET_ERROR');
  let category = 'UNKNOWN';
  if (/ENOTFOUND|EAI_AGAIN/.test(code || '')) category = 'DNS';
  else if (/CERT|TLS|SSL/.test(code || '') || /certificate|tls/i.test(detail)) category = 'TLS';
  else if (/PROXY/.test(code || '') || /proxy/i.test(detail)) category = 'PROXY';
  else if (/ECONN|ETIMEDOUT|UND_ERR_CONNECT/.test(code || '')) category = 'NETWORK';
  else if (/401|403|handshake|unexpected response/i.test(detail)) category = 'AUTH_OR_HANDSHAKE';
  const rawStatusCode = error?.statusCode ?? error?.status ?? nested?.statusCode ?? nested?.status;
  const observedStatusCode = rawStatusCode !== null && rawStatusCode !== undefined && rawStatusCode !== '' && Number.isInteger(Number(rawStatusCode))
    ? Number(rawStatusCode) : null;
  const handshake = phase === 'PRE_OPEN' ? classifyPreOpenHandshakeFailure({ statusCode: observedStatusCode,
    timedOut: code === 'ETIMEDOUT', errorCode: code }) : null;
  return { phase, category, code, detail, ...(handshake ? { handshake } : {}), secretExposed: false };
}

function statusSymbols(value) {
  if (!Array.isArray(value)) return [];
  return normalizeSymbols(value.map((entry) => typeof entry === 'string' ? entry : entry?.symbol));
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
  maxReconnects = Number.POSITIVE_INFINITY,
  maxSubscriptionRequests = Number.POSITIVE_INFINITY,
  logger = () => {}
} = {}) {
  const configuredSymbols = normalizeSymbols(symbols);
  const latestTicks = new Map();
  const acceptedSymbols = new Set();
  const rejectedSymbols = new Set();
  const metrics = {
    messagesReceived: 0,
    ticksAccepted: 0,
    duplicates: 0,
    gaps: 0,
    reconnects: 0,
    heartbeatSent: 0,
    connectionAttempts: 0,
    successfulConnections: 0,
    subscriptionsRequested: 0,
    subscriptionsAccepted: 0,
    subscriptionsRejected: 0,
    firstTickAt: null,
    lastTickAt: null,
    sessionStartedAt: null,
    completedUptimeMs: 0,
    lastReconnectBackoffMs: 0,
    reconnectBackoffMsTotal: 0,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    lastDisconnectCode: null,
    lastDisconnectReason: null,
    lastMessageAt: null,
    lastSubscriptionStatus: null,
    lastSubscriptionError: null,
    lastError: null,
    lastTransportDiagnostic: null
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
    if (metrics.reconnects >= maxReconnects || metrics.subscriptionsRequested >= maxSubscriptionRequests) {
      state = 'RECONNECT_EXHAUSTED';
      return;
    }
    const delay = Math.min(reconnectMaxMs, reconnectBaseMs * (2 ** reconnectAttempt));
    reconnectAttempt += 1;
    metrics.reconnects += 1;
    metrics.lastReconnectBackoffMs = delay;
    metrics.reconnectBackoffMsTotal += delay;
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
    if (payload?.event === 'subscribe-status') {
      const accepted = statusSymbols(payload.success);
      const rejected = statusSymbols(payload.fails ?? payload.failed);
      for (const symbol of accepted) {
        acceptedSymbols.add(symbol);
        rejectedSymbols.delete(symbol);
      }
      for (const symbol of rejected) {
        rejectedSymbols.add(symbol);
        acceptedSymbols.delete(symbol);
      }
      metrics.subscriptionsAccepted = acceptedSymbols.size;
      metrics.subscriptionsRejected = rejectedSymbols.size;
      metrics.lastSubscriptionStatus = String(payload.status || 'UNKNOWN').toUpperCase().slice(0, 40);
      metrics.lastSubscriptionError = sanitizedDetail(payload.message || payload.error || '');
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
    const receivedAtIso = new Date(receivedAt).toISOString();
    metrics.firstTickAt ??= receivedAtIso;
    metrics.lastTickAt = receivedAtIso;
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
        if (metrics.subscriptionsRequested >= maxSubscriptionRequests) {
          state = 'SUBSCRIPTION_BUDGET_EXHAUSTED';
          running = false;
          socket = null;
          if (typeof candidate.close === 'function') candidate.close();
          return;
        }
        state = 'CONNECTED';
        reconnectAttempt = 0;
        metrics.successfulConnections += 1;
        metrics.sessionStartedAt = now();
        metrics.lastConnectedAt = new Date(now()).toISOString();
        if (send({ action: 'subscribe', params: { symbols: configuredSymbols.join(',') } })) {
          metrics.subscriptionsRequested += configuredSymbols.length;
        }
        scheduleHeartbeat();
      });
      addListener(candidate, 'message', handleMessage);
      addListener(candidate, 'error', (error) => {
        metrics.lastTransportDiagnostic = transportDiagnostic(error, metrics.successfulConnections > 0 ? 'POST_OPEN' : 'PRE_OPEN');
        metrics.lastError = metrics.lastTransportDiagnostic.detail;
      });
      addListener(candidate, 'close', (event) => {
        if (socket !== candidate) return;
        socket = null;
        clearTimer(heartbeatTimer);
        heartbeatTimer = null;
        if (metrics.sessionStartedAt !== null) metrics.completedUptimeMs += Math.max(0, now() - metrics.sessionStartedAt);
        metrics.sessionStartedAt = null;
        metrics.lastDisconnectedAt = new Date(now()).toISOString();
        if (Number.isFinite(Number(event?.code))) metrics.lastDisconnectCode = Number(event.code);
        if (event?.reason) metrics.lastDisconnectReason = sanitizedDetail(event.reason);
        if (metrics.lastTransportDiagnostic) {
          metrics.lastTransportDiagnostic = { ...metrics.lastTransportDiagnostic,
            closeCode: metrics.lastDisconnectCode, closeReason: metrics.lastDisconnectReason,
            handshake: metrics.successfulConnections === 0 ? classifyPreOpenHandshakeFailure({
              statusCode: metrics.lastTransportDiagnostic.handshake?.observedStatusCode,
              timedOut: metrics.lastTransportDiagnostic.handshake?.classification === 'PRE_OPEN_TIMEOUT',
              closeCode: metrics.lastDisconnectCode, errorCode: metrics.lastTransportDiagnostic.code }) : undefined,
            secretExposed: false };
        }
        if (metrics.successfulConnections === 0 && !metrics.lastTransportDiagnostic) {
          metrics.lastTransportDiagnostic = { phase: 'PRE_OPEN', category: 'CLOSE_BEFORE_OPEN', code: null,
            closeCode: metrics.lastDisconnectCode, detail: metrics.lastDisconnectReason,
            handshake: classifyPreOpenHandshakeFailure({ closeCode: metrics.lastDisconnectCode }), secretExposed: false };
        }
        acceptedSymbols.clear();
        metrics.subscriptionsAccepted = 0;
        if (running) scheduleReconnect();
        else state = 'STOPPED';
      });
    } catch (error) {
      socket = null;
      metrics.lastTransportDiagnostic = transportDiagnostic(error, 'CONSTRUCTOR');
      metrics.lastError = metrics.lastTransportDiagnostic.detail;
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
        price: tick?.price ?? null,
        eventTimestamp: tick?.eventTimestamp ?? null,
        receivedAt: tick ? new Date(tick.receivedAt).toISOString() : null,
        ageMs,
        fresh: Boolean(tick && ageMs <= staleAfterMs)
      };
    });
    const freshSymbols = ticks.filter((tick) => tick.fresh).length;
    const tickAges = ticks.filter((tick) => tick.ageMs !== null).map((tick) => tick.ageMs);
    const sessionUptimeMs = metrics.sessionStartedAt === null ? 0 : Math.max(0, checkedAt - metrics.sessionStartedAt);
    return {
      mode: 'SHADOW_OBSERVABILITY',
      state,
      enabled,
      connected: state === 'CONNECTED',
      available: state === 'CONNECTED' && freshSymbols > 0,
      configuredSymbols: configuredSymbols.length,
      activeSymbols: acceptedSymbols.size,
      staleAfterMs,
      ...metrics,
      lastTickAgeMs: tickAges.length ? Math.min(...tickAges) : null,
      sessionUptimeMs,
      totalUptimeMs: metrics.completedUptimeMs + sessionUptimeMs,
      symbols: ticks,
      restReductionPotential: {
        observationalOnly: true,
        freshSymbols,
        requestsAvoided: 0
      },
      providerConsumption: {
        restCreditsConsumedByFeed: 0,
        wsCreditsEstimated: acceptedSymbols.size,
        wsCreditsEstimatedIsOfficial: false
      },
      reconnectBudget: { maxReconnects, exhausted: state === 'RECONNECT_EXHAUSTED' },
      subscriptionBudget: { maxSubscriptionRequests, exhausted: state === 'SUBSCRIPTION_BUDGET_EXHAUSTED' },
      authoritativeCandlesBuilt: 0,
      decisionImpact: 'NONE'
    };
  }

  return { start, stop, health };
}
