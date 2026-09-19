export const TWELVE_WS_STABILITY_OBSERVATION_VERSION = 'twelve-ws-stability-observation-v1';
const OFFICIAL_ENDPOINT = 'wss://ws.twelvedata.com/v1/quotes/price';
const SUBSCRIBE = Object.freeze({ action: 'subscribe', params: Object.freeze({ symbols: 'EUR/USD' }) });
const HEARTBEAT = Object.freeze({ action: 'heartbeat' });
const symbols = (value) => Array.isArray(value) ? value.map((item) => String(item?.symbol ?? item).toUpperCase()) : [];
const explicitAuthRejection = (payload) => payload?.status === 'error' && /auth|api.?key|entitlement|permission|not.?authorized|forbidden/i.test(String(payload?.message ?? payload?.code ?? ''));
const nativeTimers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval };

export async function observeTwelveWsStability({ endpoint = OFFICIAL_ENDPOINT, apiKey, authorization,
  allowLocalSynthetic = false, observationWindowMs = 60_000, preAcceptTimeoutMs = 5_000,
  heartbeatIntervalMs = 10_000, now = () => Date.now(), timers = nativeTimers,
  webSocketFactory = (url) => new globalThis.WebSocket(url) } = {}) {
  const target = new URL(endpoint); const local = ['localhost', '127.0.0.1', '::1'].includes(target.hostname);
  const external = endpoint === OFFICIAL_ENDPOINT && authorization === 'R8F_STABILITY_OBSERVATION_EXPLICITLY_AUTHORIZED';
  if (!(allowLocalSynthetic && local) && !external) throw new Error('STABILITY_OBSERVATION_NOT_AUTHORIZED');
  if (!apiKey) throw new Error('STABILITY_OBSERVATION_KEY_MISSING');
  if (!Number.isFinite(preAcceptTimeoutMs) || preAcceptTimeoutMs < 100 || preAcceptTimeoutMs > 5_000) throw new Error('STABILITY_PRE_ACCEPT_TIMEOUT_INVALID');
  if (!Number.isFinite(observationWindowMs) || observationWindowMs < 100 || observationWindowMs > 60_000) throw new Error('STABILITY_OBSERVATION_WINDOW_INVALID');
  if (!Number.isFinite(heartbeatIntervalMs) || heartbeatIntervalMs < 10_000) throw new Error('STABILITY_HEARTBEAT_INTERVAL_INVALID');
  target.search = ''; target.searchParams.set('apikey', apiKey); const startedAt = now();
  const state = { connections: 0, handshakeAccepted: false, subscribeAttempts: 0, subscribeAccepted: false,
    observationWindowMs, preAcceptTimeoutMs, heartbeatIntervalMs, heartbeatsSent: 0, quoteMessagesObserved: 0,
    firstQuoteElapsedMs: null, lastQuoteElapsedMs: null, maxInterQuoteGapMs: null, distinctQuoteEventTimestampCount: 0,
    outOfOrderEventCount: 0, nonPriceMessagesObserved: 0, closeCode: null, retries: 0, reconnects: 0,
    redirects: 0, applicationMessagesSent: 0 };
  return new Promise((resolve) => {
    let settled = false; let socket; let deadline; let heartbeatTimer; let acceptedAt = null;
    let priorArrival = null; let priorEventTimestamp = null; let protocolUnknown = false; const eventTimestamps = new Set();
    const finish = (classification, causeConfirmed) => {
      if (settled) return; settled = true; timers.clearTimeout(deadline); timers.clearInterval(heartbeatTimer);
      state.distinctQuoteEventTimestampCount = eventTimestamps.size;
      const report = Object.freeze({ diagnosticVersion: TWELVE_WS_STABILITY_OBSERVATION_VERSION, ...state,
        classification, causeConfirmed, providerCommissioning: false, decisionImpact: 'NONE',
        prospectivePaperAuthorized: false, ordersExecuted: 0, restRequests: 0, saxoRequests: 0, secretExposed: false });
      try { socket?.close(); } catch {} resolve(report);
    };
    const completeWindow = () => {
      if (protocolUnknown) finish('APPLICATION_PROTOCOL_INCONCLUSIVE', false);
      else if (state.quoteMessagesObserved > 1) finish('CONTINUOUS_QUOTES_OBSERVED', true);
      else if (state.quoteMessagesObserved === 1) finish('SINGLE_QUOTE_ONLY', true);
      else finish('SUBSCRIBE_ACCEPTED_NO_QUOTE_WITHIN_WINDOW', false);
    };
    try { socket = webSocketFactory(target.toString()); } catch { finish('APPLICATION_PROTOCOL_INCONCLUSIVE', false); return; }
    deadline = timers.setTimeout(() => finish('PRE_ACCEPT_TIMEOUT', false), preAcceptTimeoutMs);
    socket.addEventListener('open', () => {
      if (settled || state.subscribeAttempts) return; state.connections = 1; state.handshakeAccepted = true;
      state.subscribeAttempts = 1; state.applicationMessagesSent = 1; socket.send(JSON.stringify(SUBSCRIBE));
    });
    socket.addEventListener('message', (event) => {
      if (settled) return; let payload;
      try { payload = JSON.parse(typeof event?.data === 'string' ? event.data : String(event?.data ?? '')); }
      catch { state.nonPriceMessagesObserved += 1; protocolUnknown = true; return; }
      if (payload?.event === 'subscribe-status') {
        state.nonPriceMessagesObserved += 1;
        if (explicitAuthRejection(payload)) { finish('APPLICATION_AUTH_OR_ENTITLEMENT_REJECTED', true); return; }
        if (!symbols(payload.success).includes('EUR/USD') || symbols(payload.fails ?? payload.failed).includes('EUR/USD') || payload.status === 'error') { finish('APPLICATION_PROTOCOL_INCONCLUSIVE', false); return; }
        if (state.subscribeAccepted) return; state.subscribeAccepted = true; acceptedAt = now(); timers.clearTimeout(deadline);
        deadline = timers.setTimeout(completeWindow, observationWindowMs);
        heartbeatTimer = timers.setInterval(() => { if (settled) return; socket.send(JSON.stringify(HEARTBEAT)); state.heartbeatsSent += 1; state.applicationMessagesSent += 1; }, heartbeatIntervalMs);
        return;
      }
      if (payload?.event === 'price' && String(payload?.symbol ?? '').toUpperCase() === 'EUR/USD' && state.subscribeAccepted) {
        const elapsed = Math.max(0, now() - acceptedAt); state.quoteMessagesObserved += 1;
        state.firstQuoteElapsedMs ??= elapsed; state.lastQuoteElapsedMs = elapsed;
        if (priorArrival !== null) state.maxInterQuoteGapMs = Math.max(state.maxInterQuoteGapMs ?? 0, elapsed - priorArrival);
        priorArrival = elapsed;
        const timestamp = Number(payload.timestamp);
        if (payload.timestamp !== null && payload.timestamp !== undefined && payload.timestamp !== '' && Number.isFinite(timestamp)) {
          eventTimestamps.add(String(payload.timestamp)); if (priorEventTimestamp !== null && timestamp < priorEventTimestamp) state.outOfOrderEventCount += 1; priorEventTimestamp = timestamp;
        }
        return;
      }
      state.nonPriceMessagesObserved += 1;
      if (!['heartbeat', 'ping', 'pong'].includes(String(payload?.event ?? '').toLowerCase())) protocolUnknown = true;
    });
    socket.addEventListener('error', () => { if (!state.handshakeAccepted) finish('APPLICATION_PROTOCOL_INCONCLUSIVE', false); });
    socket.addEventListener('close', (event) => { if (settled) return; state.closeCode = Number.isFinite(Number(event?.code)) ? Number(event.code) : null; finish(state.subscribeAccepted ? 'POST_SUBSCRIBE_ABNORMAL_CLOSE' : 'APPLICATION_PROTOCOL_INCONCLUSIVE', false); });
  });
}
