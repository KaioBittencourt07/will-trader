/* WILL TRADER — Avalon Traderoom Discovery
 * SAFE MODE: observes browser-side network metadata only.
 * Does NOT send orders, alter requests, bypass authentication, or collect credentials.
 * Use only on a session/account you are authorized to access.
 *
 * Usage:
 * 1) Open the Avalon Traderoom.
 * 2) Open DevTools (F12) -> Console.
 * 3) Paste this file's contents and press Enter.
 * 4) Reload the Traderoom once so future WebSocket connections are observed.
 * 5) Change assets/timeframes normally. Watch the console output.
 *
 * It records host/path/protocol and small text messages that look like market data.
 * Tokens/passwords are intentionally redacted.
 */
(() => {
  if (window.__WILL_AVALON_DISCOVERY__) {
    console.warn('[WILL] Discovery already active.');
    return;
  }
  window.__WILL_AVALON_DISCOVERY__ = true;
  const started = new Date().toISOString();
  const originalWS = window.WebSocket;
  const originalFetch = window.fetch;
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const SENSITIVE = /(token|access_token|refresh_token|authorization|password|passwd|secret|api[-_]?key|cookie|session)/i;
  const MAX = 1800;
  const redact = value => String(value).replace(/([?&](?:token|access_token|refresh_token|authorization|password|secret|api[-_]?key)=[^&\s]+)/ig, '$1=[REDACTED]').slice(0, MAX);
  const looksLikeMarket = text => {
    const s = String(text).toLowerCase();
    return /(eur\/usd|gbp\/usd|usd\/jpy|gold|xau|btc|eth|ohlc|candle|quote|price|bid|ask|open|high|low|close|timestamp|symbol|asset|profit|payout)/i.test(s);
  };
  const emit = (type, data) => {
    const item = {time:new Date().toISOString(), type, ...data};
    console.log('%c[WILL AVALON DISCOVERY]', 'color:#27df87;font-weight:900', item);
    window.__WILL_AVALON_LOG__.push(item);
  };
  window.__WILL_AVALON_LOG__ = [];
  window.__WILL_AVALON_EXPORT__ = () => {
    const blob = new Blob([JSON.stringify(window.__WILL_AVALON_LOG__, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'will-avalon-discovery.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  window.WebSocket = function(url, protocols) {
    const ws = protocols === undefined ? new originalWS(url) : new originalWS(url, protocols);
    emit('websocket-open', {url:redact(url)});
    ws.addEventListener('message', e => {
      if (typeof e.data === 'string') {
        const text = redact(e.data);
        if (looksLikeMarket(text)) emit('websocket-message', {url:redact(url), data:text});
      } else if (e.data instanceof Blob) {
        emit('websocket-binary', {url:redact(url), size:e.data.size, note:'binary frame; contents not decoded'});
      } else if (e.data instanceof ArrayBuffer) {
        emit('websocket-binary', {url:redact(url), size:e.data.byteLength, note:'binary frame; contents not decoded'});
      }
    });
    ws.addEventListener('close', e => emit('websocket-close', {url:redact(url), code:e.code, reason:e.reason || ''}));
    return ws;
  };
  window.WebSocket.prototype = originalWS.prototype;
  window.WebSocket.CONNECTING = originalWS.CONNECTING;
  window.WebSocket.OPEN = originalWS.OPEN;
  window.WebSocket.CLOSING = originalWS.CLOSING;
  window.WebSocket.CLOSED = originalWS.CLOSED;

  window.fetch = async (...args) => {
    const input = args[0];
    const url = typeof input === 'string' ? input : input?.url;
    if (url && !SENSITIVE.test(url)) emit('fetch', {url:redact(url), method:args[1]?.method || 'GET'});
    return originalFetch(...args);
  };

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__willUrl = url;
    this.__willMethod = method;
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(body) {
    if (this.__willUrl && !SENSITIVE.test(this.__willUrl)) {
      emit('xhr', {url:redact(this.__willUrl), method:this.__willMethod || 'GET'});
    }
    return originalSend.call(this, body);
  };

  const resources = performance.getEntriesByType('resource').map(x => x.name).filter(x => /avalon|trade|ws|socket|quote|price|api/i.test(x));
  emit('startup', {started, page:location.href.replace(/([?&](?:token|code|key)=[^&]+)/ig, '$1=[REDACTED]'), resourceCandidates:[...new Set(resources)].map(redact)});
  console.log('%c[WILL] Discovery ativo. Recarregue a página agora.', 'color:#63a9ff;font-weight:900');
  console.log('%c[WILL] Depois troque ativo/timeframe normalmente. Para exportar: __WILL_AVALON_EXPORT__()', 'color:#f4c84e;font-weight:900');
})();
