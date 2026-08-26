/*
 * Run ONLY inside the authenticated Avalon Traderoom DevTools console.
 * Read-only: captures incoming WebSocket messages and exposes them as
 * window.__WILL_AVALON__. It does not send messages, click buttons,
 * access passwords, cookies or authorization headers.
 *
 * Important: run this before reloading the Traderoom so the WebSocket
 * constructor can be wrapped before the session socket is created.
 */
(() => {
  if (window.__WILL_AVALON__) {
    console.info('[WILL] capture already installed');
    return;
  }

  const OriginalWebSocket = window.WebSocket;
  const events = [];
  const subscribers = new Set();
  const MAX_EVENTS = 5000;

  const publish = (event) => {
    events.push(event);
    if (events.length > MAX_EVENTS) events.shift();
    subscribers.forEach((fn) => { try { fn(event); } catch (_) {} });
  };

  window.WebSocket = function(...args) {
    const socket = new OriginalWebSocket(...args);
    socket.addEventListener('message', (e) => {
      if (typeof e.data !== 'string') return;
      try {
        const parsed = JSON.parse(e.data);
        publish({ receivedAt: Date.now(), data: parsed });
      } catch (_) {
        // Ignore binary/non-JSON frames.
      }
    });
    return socket;
  };

  Object.setPrototypeOf(window.WebSocket, OriginalWebSocket);
  window.WebSocket.prototype = OriginalWebSocket.prototype;
  ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((k) => {
    Object.defineProperty(window.WebSocket, k, { value: OriginalWebSocket[k] });
  });

  window.__WILL_AVALON__ = Object.freeze({
    events,
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    filter(name) { return events.filter(x => x.data?.name === name); },
    candles() { return events.filter(x => x.data?.name === 'candle-generated'); },
    timeSync() { return events.filter(x => x.data?.name === 'timeSync'); },
    stats() {
      const counts = {};
      for (const x of events) {
        const name = x.data?.name || 'unknown';
        counts[name] = (counts[name] || 0) + 1;
      }
      return counts;
    }
  });

  console.info('[WILL] Avalon readonly capture installed. Reload Traderoom now.');
})();
