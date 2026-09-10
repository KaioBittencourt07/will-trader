export const TWELVE_POST_SUBSCRIBE_OBSERVATION_VERSION = 'twelve-post-subscribe-observation-v1';
const OFFICIAL_ENDPOINT = 'wss://ws.twelvedata.com/v1/quotes/price';
const SUBSCRIBE = Object.freeze({ action: 'subscribe', params: Object.freeze({ symbols: 'EUR/USD' }) });
const symbolList = (value) => Array.isArray(value) ? value.map((item) => String(item?.symbol ?? item).toUpperCase()) : [];
const explicitAuthRejection = (payload) => payload?.status === 'error' && /auth|api.?key|entitlement|permission|not.?authorized|forbidden/i.test(String(payload?.message ?? payload?.code ?? ''));

export async function observeTwelvePostSubscribe({ endpoint = OFFICIAL_ENDPOINT, apiKey, authorization,
  allowLocalSynthetic = false, observationWindowMs = 60_000, now = () => Date.now(),
  webSocketFactory = (url) => new globalThis.WebSocket(url) } = {}) {
  const target = new URL(endpoint);
  const local = ['localhost', '127.0.0.1', '::1'].includes(target.hostname);
  const externalAuthorized = endpoint === OFFICIAL_ENDPOINT && authorization === 'R8C_PROLONGED_OBSERVATION_EXPLICITLY_AUTHORIZED';
  if (!(allowLocalSynthetic && local) && !externalAuthorized) throw new Error('POST_SUBSCRIBE_OBSERVATION_NOT_AUTHORIZED');
  if (!apiKey) throw new Error('POST_SUBSCRIBE_OBSERVATION_KEY_MISSING');
  if (!Number.isFinite(observationWindowMs) || observationWindowMs < 100 || observationWindowMs > 60_000) throw new Error('POST_SUBSCRIBE_OBSERVATION_WINDOW_INVALID');
  target.search = ''; target.searchParams.set('apikey', apiKey);
  const startedAt = now();
  const state = { connections: 0, handshakeAccepted: false, subscribeSent: false, subscribeAttempts: 0,
    subscribeAccepted: false, firstQuoteObserved: false, quoteMessagesObserved: 0, nonPriceMessagesObserved: 0,
    elapsedMsToSubscribeStatus: null, elapsedMsToFirstQuote: null, observationWindowMs,
    closeCode: null, retries: 0, reconnects: 0, redirects: 0, applicationMessagesSent: 0 };
  return new Promise((resolve) => {
    let settled = false; let socket; let timer; let protocolUnknownObserved = false;
    const finish = (classification, causeConfirmed) => {
      if (settled) return; settled = true; clearTimeout(timer);
      const report = Object.freeze({ diagnosticVersion: TWELVE_POST_SUBSCRIBE_OBSERVATION_VERSION, ...state,
        classification, causeConfirmed, providerCommissioning: false, decisionImpact: 'NONE',
        prospectivePaperAuthorized: false, ordersExecuted: 0, restRequests: 0, saxoRequests: 0, secretExposed: false });
      try { socket?.close(); } catch {}
      resolve(report);
    };
    try { socket = webSocketFactory(target.toString()); }
    catch { finish('APPLICATION_PROTOCOL_INCONCLUSIVE', false); return; }
    timer = setTimeout(() => finish(state.subscribeAccepted && !protocolUnknownObserved ? 'SUBSCRIBE_ACCEPTED_NO_QUOTE_WITHIN_WINDOW' : 'APPLICATION_PROTOCOL_INCONCLUSIVE', false), observationWindowMs);
    socket.addEventListener('open', () => {
      if (settled || state.subscribeAttempts) return;
      state.connections = 1; state.handshakeAccepted = true; state.subscribeAttempts = 1;
      socket.send(JSON.stringify(SUBSCRIBE)); state.subscribeSent = true; state.applicationMessagesSent = 1;
    });
    socket.addEventListener('message', (event) => {
      if (settled) return;
      let payload;
      try { payload = JSON.parse(typeof event?.data === 'string' ? event.data : String(event?.data ?? '')); }
      catch { state.nonPriceMessagesObserved += 1; protocolUnknownObserved = true; return; }
      if (payload?.event === 'subscribe-status') {
        state.nonPriceMessagesObserved += 1; state.elapsedMsToSubscribeStatus ??= Math.max(0, now() - startedAt);
        if (explicitAuthRejection(payload)) { finish('APPLICATION_AUTH_OR_ENTITLEMENT_REJECTED', true); return; }
        const accepted = symbolList(payload.success).includes('EUR/USD');
        const rejected = symbolList(payload.fails ?? payload.failed).includes('EUR/USD') || payload.status === 'error';
        if (rejected || !accepted) { finish('APPLICATION_PROTOCOL_INCONCLUSIVE', false); return; }
        state.subscribeAccepted = true; return;
      }
      if (payload?.event === 'price' && String(payload?.symbol ?? '').toUpperCase() === 'EUR/USD') {
        if (!state.subscribeAccepted) { state.nonPriceMessagesObserved += 1; return; }
        state.firstQuoteObserved = true; state.quoteMessagesObserved += 1;
        state.elapsedMsToFirstQuote = Math.max(0, now() - startedAt);
        finish('QUOTE_OBSERVED_WITHIN_WINDOW', true); return;
      }
      state.nonPriceMessagesObserved += 1;
      if (!['heartbeat', 'ping', 'pong'].includes(String(payload?.event ?? '').toLowerCase())) protocolUnknownObserved = true;
    });
    socket.addEventListener('error', () => { if (!state.handshakeAccepted) finish('APPLICATION_PROTOCOL_INCONCLUSIVE', false); });
    socket.addEventListener('close', (event) => {
      if (settled) return;
      state.closeCode = Number.isFinite(Number(event?.code)) ? Number(event.code) : null;
      finish(state.subscribeAccepted ? 'POST_SUBSCRIBE_ABNORMAL_CLOSE' : 'APPLICATION_PROTOCOL_INCONCLUSIVE', false);
    });
  });
}
