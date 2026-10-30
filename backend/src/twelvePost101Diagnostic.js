export const TWELVE_POST_101_DIAGNOSTIC_VERSION = 'twelve-post-101-diagnostic-v1';
const OFFICIAL_ENDPOINT = 'wss://ws.twelvedata.com/v1/quotes/price';
const SUBSCRIBE = Object.freeze({ action: 'subscribe', params: Object.freeze({ symbols: 'EUR/USD' }) });

const symbols = (value) => Array.isArray(value) ? value.map((entry) => String(entry?.symbol ?? entry).toUpperCase()) : [];
const explicitAuthRejection = (payload) => payload?.status === 'error' && /auth|api.?key|entitlement|permission|not.?authorized|forbidden/i.test(String(payload?.message ?? payload?.code ?? ''));

export async function diagnoseTwelvePost101({ endpoint = OFFICIAL_ENDPOINT, apiKey, authorization,
  allowLocalSynthetic = false, timeoutMs = 5_000,
  webSocketFactory = (url) => new globalThis.WebSocket(url) } = {}) {
  const target = new URL(endpoint);
  const local = ['localhost', '127.0.0.1', '::1'].includes(target.hostname);
  const externalAuthorized = endpoint === OFFICIAL_ENDPOINT && authorization === 'R8B_POST_101_EXPLICITLY_AUTHORIZED';
  if (!(allowLocalSynthetic && local) && !externalAuthorized) throw new Error('POST_101_DIAGNOSTIC_NOT_AUTHORIZED');
  if (!apiKey) throw new Error('POST_101_DIAGNOSTIC_KEY_MISSING');
  if (!['ws:', 'wss:'].includes(target.protocol)) throw new Error('POST_101_DIAGNOSTIC_PROTOCOL_INVALID');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 5_000) throw new Error('POST_101_DIAGNOSTIC_TIMEOUT_INVALID');
  target.search = ''; target.searchParams.set('apikey', apiKey);
  const state = { handshakeStatus: null, handshakeAccepted: false, subscribeSent: false, subscribeAttempts: 0,
    subscribeStatusObserved: false, subscribeAccepted: false, quoteObserved: false, quoteEventType: null,
    quoteTimestampPresent: false, closeCode: null, retries: 0, reconnects: 0, applicationMessagesSent: 0 };
  return new Promise((resolve) => {
    let settled = false; let socket; let timer;
    const finish = (classification, causeConfirmed) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      const report = Object.freeze({ diagnosticVersion: TWELVE_POST_101_DIAGNOSTIC_VERSION, ...state,
        classification, causeConfirmed, providerCommissioning: false, decisionImpact: 'NONE',
        prospectivePaperAuthorized: false, ordersExecuted: 0, restRequests: 0, saxoRequests: 0, secretExposed: false });
      try { socket?.close(); } catch {}
      resolve(report);
    };
    try { socket = webSocketFactory(target.toString()); }
    catch { finish('POST_UPGRADE_INCONCLUSIVE', false); return; }
    timer = setTimeout(() => finish(state.subscribeAccepted ? 'SUBSCRIBE_ACCEPTED_QUOTE_TIMEOUT' : 'POST_UPGRADE_TIMEOUT', true), timeoutMs);
    socket.addEventListener('open', () => {
      if (settled || state.subscribeAttempts >= 1) return;
      state.handshakeStatus = 101; state.handshakeAccepted = true; state.subscribeAttempts = 1;
      socket.send(JSON.stringify(SUBSCRIBE)); state.subscribeSent = true; state.applicationMessagesSent = 1;
    });
    socket.addEventListener('message', (event) => {
      if (settled) return;
      let payload;
      try { payload = JSON.parse(typeof event?.data === 'string' ? event.data : String(event?.data ?? '')); }
      catch { finish('APPLICATION_PROTOCOL_UNRECOGNIZED', true); return; }
      if (payload?.event === 'subscribe-status') {
        state.subscribeStatusObserved = true;
        if (explicitAuthRejection(payload)) { finish('APPLICATION_AUTH_OR_ENTITLEMENT_REJECTED', true); return; }
        const accepted = symbols(payload.success).includes('EUR/USD');
        const rejected = symbols(payload.fails ?? payload.failed).includes('EUR/USD') || payload.status === 'error';
        if (rejected || !accepted) { finish('SUBSCRIBE_REJECTED', true); return; }
        state.subscribeAccepted = true; return;
      }
      if (payload?.event === 'price' && String(payload?.symbol || '').toUpperCase() === 'EUR/USD') {
        if (!state.subscribeAccepted) { finish('APPLICATION_PROTOCOL_UNRECOGNIZED', true); return; }
        state.quoteObserved = true; state.quoteEventType = 'price';
        state.quoteTimestampPresent = payload.timestamp !== null && payload.timestamp !== undefined && payload.timestamp !== '';
        finish('HANDSHAKE_ACCEPTED_SUBSCRIBE_ACCEPTED_QUOTE_OBSERVED', true); return;
      }
      finish('APPLICATION_PROTOCOL_UNRECOGNIZED', true);
    });
    socket.addEventListener('error', () => { if (!state.handshakeAccepted) finish('POST_UPGRADE_INCONCLUSIVE', false); });
    socket.addEventListener('close', (event) => {
      if (settled) return;
      state.closeCode = Number.isFinite(Number(event?.code)) ? Number(event.code) : null;
      finish(state.handshakeAccepted ? 'POST_UPGRADE_ABNORMAL_CLOSE' : 'POST_UPGRADE_INCONCLUSIVE', false);
    });
  });
}
