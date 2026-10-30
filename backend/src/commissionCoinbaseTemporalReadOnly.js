import { observationFromCoinbaseTicker, qualifyCoinbaseTickerSeries, coinbaseProductFor } from './coinbaseTemporalAuthority.js';

const WS_URL = 'wss://ws-feed.exchange.coinbase.com';

function addListener(socket, event, handler) {
  if (typeof socket.addEventListener === 'function') socket.addEventListener(event, handler);
  else socket[`on${event}`] = handler;
}

export async function runCoinbaseTemporalCommissioning({
  webSocketFactory = (url) => new WebSocket(url),
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  durationMs = 12_000,
  maxAccepted = 20,
  symbol = 'BTC/USD'
} = {}) {
  const providerProduct = coinbaseProductFor(symbol);
  const observations = [];
  const failures = [];
  let messagesReceived = 0;
  let subscriptionsAccepted = 0;
  let socket = null;
  let finished = false;
  let timer = null;

  const finish = (resolve) => {
    if (finished) return;
    finished = true;
    clearTimer(timer);
    try { socket?.close?.(); } catch {}
    const checkedAt = now();
    const qualification = qualifyCoinbaseTickerSeries({ observations, now: checkedAt });
    const authority = qualification.temporalAuthority;
    const approved = qualification.canEvaluateFrozenFreshness === true
      && authority?.authorityGate === 'PASS'
      && authority?.freshnessGate === 'PASS';
    resolve(Object.freeze({
      status: approved ? 'APPROVED' : 'BLOCKED',
      semanticApproved: qualification.canEvaluateFrozenFreshness === true,
      temporalApproved: approved,
      symbol,
      providerProduct,
      endpoint: WS_URL,
      channel: 'ticker',
      authenticationRequired: false,
      messagesReceived,
      subscriptionsAccepted,
      acceptedObservations: observations.length,
      maxAccepted,
      failures: Object.freeze([...failures]),
      qualification,
      temporalAuthority: authority,
      rawObservationsExposed: false,
      secretExposed: false,
      decisionImpact: 'NONE',
      prospectivePaperAuthorized: false,
      ordersExecuted: 0
    }));
  };

  return new Promise((resolve) => {
    try {
      socket = webSocketFactory(WS_URL);
    } catch (error) {
      failures.push(error?.message || 'COINBASE_WEBSOCKET_CONSTRUCTOR_FAILED');
      finish(resolve);
      return;
    }

    timer = setTimer(() => finish(resolve), Math.min(30_000, Math.max(5_000, Number(durationMs) || 12_000)));

    addListener(socket, 'open', () => {
      try {
        socket.send(JSON.stringify({
          type: 'subscribe',
          product_ids: [providerProduct],
          channels: ['ticker']
        }));
      } catch (error) {
        failures.push(error?.message || 'COINBASE_SUBSCRIBE_SEND_FAILED');
        finish(resolve);
      }
    });

    addListener(socket, 'message', (event) => {
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
        observations.push(observationFromCoinbaseTicker({
          payload,
          receivedAt: new Date(now()).toISOString(),
          canonicalSymbol: symbol
        }));
      } catch (error) {
        failures.push(error?.message || 'COINBASE_TICKER_PARSE_FAILED');
      }
      if (observations.length >= Math.max(4, Number(maxAccepted) || 20)) finish(resolve);
    });

    addListener(socket, 'error', (error) => {
      failures.push(String(error?.message || error?.type || 'COINBASE_WEBSOCKET_ERROR').slice(0, 200));
    });

    addListener(socket, 'close', () => {
      if (!finished) finish(resolve);
    });
  });
}

const directRun = process.argv[1] && new URL(import.meta.url).pathname.replace(/^\/(.:)/, '$1').replace(/\//g, process.platform === 'win32' ? '\\' : '/') === process.argv[1];
if (directRun) {
  console.log(JSON.stringify(await runCoinbaseTemporalCommissioning(), null, 2));
}
