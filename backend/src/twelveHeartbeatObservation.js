export const TWELVE_HEARTBEAT_OBSERVATION_VERSION = 'twelve-heartbeat-observation-v1';
const OFFICIAL_ENDPOINT = 'wss://ws.twelvedata.com/v1/quotes/price';
const SUBSCRIBE = Object.freeze({ action: 'subscribe', params: Object.freeze({ symbols: 'EUR/USD' }) });
const HEARTBEAT = Object.freeze({ action: 'heartbeat' });
const symbols = (value) => Array.isArray(value) ? value.map((item) => String(item?.symbol ?? item).toUpperCase()) : [];
const explicitAuthRejection = (payload) => payload?.status === 'error' && /auth|api.?key|entitlement|permission|not.?authorized|forbidden/i.test(String(payload?.message ?? payload?.code ?? ''));

export async function observeTwelveHeartbeatSession({ endpoint = OFFICIAL_ENDPOINT, apiKey, authorization,
  allowLocalSynthetic = false, observationWindowMs = 60_000, preAcceptTimeoutMs = 5_000,
  heartbeatIntervalMs = 10_000, now = () => Date.now(), webSocketFactory = (url) => new globalThis.WebSocket(url) } = {}) {
  const target = new URL(endpoint); const local = ['localhost', '127.0.0.1', '::1'].includes(target.hostname);
  const external = endpoint === OFFICIAL_ENDPOINT && authorization === 'R8D_HEARTBEAT_OBSERVATION_EXPLICITLY_AUTHORIZED';
  if (!(allowLocalSynthetic && local) && !external) throw new Error('HEARTBEAT_OBSERVATION_NOT_AUTHORIZED');
  if (!apiKey) throw new Error('HEARTBEAT_OBSERVATION_KEY_MISSING');
  if (!Number.isFinite(observationWindowMs) || observationWindowMs < 100 || observationWindowMs > 60_000) throw new Error('HEARTBEAT_OBSERVATION_WINDOW_INVALID');
  if (!Number.isFinite(preAcceptTimeoutMs) || preAcceptTimeoutMs < 100 || preAcceptTimeoutMs > 60_000) throw new Error('HEARTBEAT_PRE_ACCEPT_TIMEOUT_INVALID');
  if (!Number.isFinite(heartbeatIntervalMs) || heartbeatIntervalMs <= 0 || (!local && heartbeatIntervalMs < 10_000)) throw new Error('HEARTBEAT_INTERVAL_INVALID');
  target.search = ''; target.searchParams.set('apikey', apiKey); const startedAt = now();
  const state = { connections: 0, handshakeAccepted: false, subscribeSent: false, subscribeAttempts: 0,
    subscribeAccepted: false, heartbeatsSent: 0, heartbeatIntervalMs, firstQuoteObserved: false,
    quoteMessagesObserved: 0, nonPriceMessagesObserved: 0, elapsedMsToSubscribeStatus: null,
    elapsedMsToFirstQuote: null, observationWindowMs, preAcceptTimeoutMs, closeCode: null,
    retries: 0, reconnects: 0, redirects: 0, applicationMessagesSent: 0 };
  return new Promise((resolve) => {
    let settled = false; let socket; let deadline; let heartbeatTimer; let acceptedAt = null; let unknown = false;
    const finish = (classification, causeConfirmed) => {
      if (settled) return; settled = true; clearTimeout(deadline); clearInterval(heartbeatTimer);
      const report = Object.freeze({ diagnosticVersion: TWELVE_HEARTBEAT_OBSERVATION_VERSION, ...state,
        classification, causeConfirmed, providerCommissioning: false, decisionImpact: 'NONE',
        prospectivePaperAuthorized: false, ordersExecuted: 0, restRequests: 0, saxoRequests: 0, secretExposed: false });
      try { socket?.close(); } catch {} resolve(report);
    };
    try { socket = webSocketFactory(target.toString()); } catch { finish('APPLICATION_PROTOCOL_INCONCLUSIVE', false); return; }
    deadline = setTimeout(() => finish('PRE_ACCEPT_TIMEOUT', false), preAcceptTimeoutMs);
    socket.addEventListener('open', () => {
      if (settled || state.subscribeAttempts) return; state.connections = 1; state.handshakeAccepted = true;
      state.subscribeAttempts = 1; state.subscribeSent = true; state.applicationMessagesSent = 1; socket.send(JSON.stringify(SUBSCRIBE));
    });
    socket.addEventListener('message', (event) => {
      if (settled) return; let payload;
      try { payload = JSON.parse(typeof event?.data === 'string' ? event.data : String(event?.data ?? '')); }
      catch { state.nonPriceMessagesObserved += 1; unknown = true; return; }
      if (payload?.event === 'subscribe-status') {
        state.nonPriceMessagesObserved += 1; state.elapsedMsToSubscribeStatus ??= Math.max(0, now() - startedAt);
        if (explicitAuthRejection(payload)) { finish('APPLICATION_AUTH_OR_ENTITLEMENT_REJECTED', true); return; }
        if (!symbols(payload.success).includes('EUR/USD') || symbols(payload.fails ?? payload.failed).includes('EUR/USD') || payload.status === 'error') { finish('APPLICATION_PROTOCOL_INCONCLUSIVE', false); return; }
        if (state.subscribeAccepted) return; state.subscribeAccepted = true; acceptedAt = now(); clearTimeout(deadline);
        deadline = setTimeout(() => finish(unknown ? 'APPLICATION_PROTOCOL_INCONCLUSIVE' : 'SUBSCRIBE_ACCEPTED_NO_QUOTE_WITH_HEARTBEATS', false), observationWindowMs);
        heartbeatTimer = setInterval(() => { if (settled) return; socket.send(JSON.stringify(HEARTBEAT)); state.heartbeatsSent += 1; state.applicationMessagesSent += 1; }, heartbeatIntervalMs);
        return;
      }
      if (payload?.event === 'price' && String(payload?.symbol ?? '').toUpperCase() === 'EUR/USD') {
        if (!state.subscribeAccepted) { state.nonPriceMessagesObserved += 1; unknown = true; return; }
        state.firstQuoteObserved = true; state.quoteMessagesObserved = 1; state.elapsedMsToFirstQuote = Math.max(0, now() - acceptedAt);
        finish('QUOTE_OBSERVED_WITH_HEARTBEAT_SESSION', true); return;
      }
      state.nonPriceMessagesObserved += 1;
      if (!['heartbeat', 'ping', 'pong'].includes(String(payload?.event ?? '').toLowerCase())) unknown = true;
    });
    socket.addEventListener('error', () => { if (!state.handshakeAccepted) finish('APPLICATION_PROTOCOL_INCONCLUSIVE', false); });
    socket.addEventListener('close', (event) => { if (settled) return; state.closeCode = Number.isFinite(Number(event?.code)) ? Number(event.code) : null; finish(state.subscribeAccepted ? 'POST_SUBSCRIBE_ABNORMAL_CLOSE' : 'APPLICATION_PROTOCOL_INCONCLUSIVE', false); });
  });
}
