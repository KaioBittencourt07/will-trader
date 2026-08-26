// Avalon readonly feed parser.
// Receives parsed WebSocket messages from the Traderoom bridge.
// It NEVER sends orders or calls trading endpoints.

export const AvalonFeed = (() => {
  const state = new Map();
  const listeners = new Set();
  let serverTimeMs = null;

  const emit = () => {
    const snapshot = getSnapshot();
    listeners.forEach((fn) => {
      try { fn(snapshot); } catch (_) {}
    });
  };

  function onUpdate(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function ingest(event) {
    if (!event || typeof event !== "object") return false;

    if (event.name === "timeSync" && Number.isFinite(Number(event.msg))) {
      serverTimeMs = Number(event.msg);
      emit();
      return true;
    }

    if (event.name !== "candle-generated") return false;
    const msg = event.msg || {};
    const activeId = Number(msg.active_id);
    if (!Number.isFinite(activeId)) return false;

    const previous = state.get(activeId) || {};
    state.set(activeId, {
      ...previous,
      activeId,
      size: Number(msg.size) || null,
      candleId: Number(msg.id) || null,
      atNs: Number(msg.at) || null,
      from: Number(msg.from) || null,
      to: Number(msg.to) || null,
      open: Number(msg.open),
      high: Number(msg.max),
      low: Number(msg.min),
      close: Number(msg.close),
      ask: Number(msg.ask),
      bid: Number(msg.bid),
      volume: Number(msg.volume) || 0,
      phase: msg.phase || null,
      updatedAt: Date.now(),
      serverTimeMs,
    });
    emit();
    return true;
  }

  function getSnapshot() {
    return {
      serverTimeMs,
      assets: Array.from(state.values()).sort((a, b) => a.activeId - b.activeId),
      receivedAt: Date.now(),
    };
  }

  function getAsset(activeId) {
    return state.get(Number(activeId)) || null;
  }

  return Object.freeze({ ingest, onUpdate, getSnapshot, getAsset });
})();
