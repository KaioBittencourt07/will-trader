// Run only in an Avalon Traderoom session you are authorized to access.
// Captures only sanitized quote/candle events from the known market WebSocket host.
// It never reads cookies, passwords, authorization headers, or sends WebSocket messages.
(() => {
  const TARGET_HOST = 'ws03.ws.prod.sc-ams-1a.quadcode.tech';
  const relayBase = String(window.WILL_AVALON_RELAY_URL || prompt('URL base do backend WILL', 'http://127.0.0.1:3000') || '').trim();
  const token = String(prompt('Token local WILL_AVALON_RELAY_TOKEN') || '');
  if (!relayBase || !token) throw new Error('URL do backend e token local são necessários.');

  const relayUrl = new URL(relayBase);
  const relayHost = relayUrl.hostname.toLowerCase().replace('[', '').replace(']', '');
  const localRelay = ['localhost', '127.0.0.1', '::1'].includes(relayHost);
  if (relayUrl.protocol !== 'https:' && !localRelay) throw new Error('Backend remoto deve usar HTTPS.');
  const endpoint = new URL('/api/avalon/ingest', relayUrl).toString();
  const NativeWebSocket = window.WebSocket;
  let matchingSockets = 0;
  let sent = 0;
  let failed = 0;
  let ignored = 0;
  const pending = new Map();
  const timers = new Map();

  async function send(event) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'X-WILL-RELAY-TOKEN': token
        },
        body: JSON.stringify({ event })
      });
      if (response.ok) sent += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }

  function schedule(event) {
    const key = event.name === 'timeSync' ? 'timeSync' : String(event.msg?.active_id ?? 'unknown');
    pending.set(key, event);
    if (timers.has(key)) return;
    const delayMs = event.name === 'timeSync' ? 2_000 : 250;
    timers.set(key, setTimeout(() => {
      const latest = pending.get(key);
      pending.delete(key);
      timers.delete(key);
      if (latest) void send(latest);
    }, delayMs));
  }

  const WrappedWebSocket = function (url, protocols) {
    if (!new.target) throw new TypeError('WebSocket constructor must be called with new');
    const socket = protocols === undefined
      ? new NativeWebSocket(url)
      : new NativeWebSocket(url, protocols);
    let hostname = '';
    try { hostname = new URL(String(url), location.href).hostname.toLowerCase(); } catch {}
    if (hostname !== TARGET_HOST) return socket;

    matchingSockets += 1;
    socket.addEventListener('message', (messageEvent) => {
      if (typeof messageEvent.data !== 'string') { ignored += 1; return; }
      let parsed;
      try { parsed = JSON.parse(messageEvent.data); } catch { ignored += 1; return; }

      if (parsed?.name === 'timeSync') {
        if (typeof parsed.msg === 'number' || typeof parsed.msg === 'string') {
          schedule({ name: 'timeSync', msg: parsed.msg });
        } else ignored += 1;
        return;
      }

      if (parsed?.name !== 'candle-generated' || !parsed.msg || typeof parsed.msg !== 'object') {
        ignored += 1;
        return;
      }
      const allowed = ['active_id', 'size', 'id', 'at', 'from', 'to', 'open', 'max', 'min', 'close', 'bid', 'ask', 'volume', 'phase'];
      const msg = {};
      for (const key of allowed) {
        if (parsed.msg[key] !== undefined && parsed.msg[key] !== null) msg[key] = parsed.msg[key];
      }
      schedule({ name: 'candle-generated', msg });
    });
    return socket;
  };

  Object.setPrototypeOf(WrappedWebSocket, NativeWebSocket);
  WrappedWebSocket.prototype = NativeWebSocket.prototype;
  window.WebSocket = WrappedWebSocket;

  window.__WILL_AVALON_BRIDGE__ = {
    targetHost: TARGET_HOST,
    endpoint,
    stats: () => ({ matchingSockets, sent, failed, ignored, pendingEvents: pending.size }),
    stop: () => {
      window.WebSocket = NativeWebSocket;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      pending.clear();
      delete window.__WILL_AVALON_BRIDGE__;
    }
  };

  console.info('WILL Avalon bridge ativo em modo somente leitura. Recarregue a Traderoom para capturar novas conexões. Status: window.__WILL_AVALON_BRIDGE__.stats()');
})();
