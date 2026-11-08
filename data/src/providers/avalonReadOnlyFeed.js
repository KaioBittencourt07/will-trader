export const AVALON_READONLY_FEED_VERSION = 'avalon-readonly-feed-v1';

const finite = (value) => value !== null && value !== undefined && value !== ''
  && Number.isFinite(Number(value));

/**
 * Read-only, shadow-mode parser for already-authorized Avalon Traderoom events.
 * It preserves provider time fields as raw values; no timestamp unit is assumed.
 */
export function createAvalonReadOnlyFeed({ now = () => Date.now(), maxAssets = 64 } = {}) {
  const assets = new Map();
  let serverTimeRaw = null;
  let serverTimeReceivedAt = null;
  let lastMessageAt = null;
  let acceptedMessages = 0;
  let rejectedMessages = 0;
  let ignoredMessages = 0;
  let lastRejectReason = null;

  function reject(reason) {
    rejectedMessages += 1;
    lastRejectReason = reason;
    return Object.freeze({ accepted: false, ignored: false, reason });
  }

  function ingest(event) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) return reject('EVENT_INVALID');

    if (event.name === 'timeSync') {
      if (!finite(event.msg) || Number(event.msg) <= 0) return reject('TIMESYNC_INVALID');
      serverTimeRaw = Number(event.msg);
      serverTimeReceivedAt = now();
      lastMessageAt = serverTimeReceivedAt;
      acceptedMessages += 1;
      lastRejectReason = null;
      return Object.freeze({ accepted: true, kind: 'timeSync' });
    }

    if (event.name !== 'candle-generated') {
      ignoredMessages += 1;
      return Object.freeze({ accepted: false, ignored: true, reason: 'EVENT_NOT_SUPPORTED' });
    }

    const msg = event.msg;
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return reject('CANDLE_MESSAGE_INVALID');
    const activeId = Number(msg.active_id);
    if (!Number.isSafeInteger(activeId) || activeId <= 0) return reject('ACTIVE_ID_INVALID');

    const open = Number(msg.open);
    const high = Number(msg.max);
    const low = Number(msg.min);
    const close = Number(msg.close);
    const bid = Number(msg.bid);
    const ask = Number(msg.ask);
    if (![open, high, low, close, bid, ask].every(Number.isFinite)) return reject('OHLC_OR_QUOTE_NON_FINITE');
    if ([open, high, low, close, bid, ask].some((value) => value <= 0)) return reject('OHLC_OR_QUOTE_NON_POSITIVE');
    if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) return reject('OHLC_INCONSISTENT');
    if (ask < bid) return reject('SPREAD_INCONSISTENT');
    if (finite(msg.volume) && Number(msg.volume) < 0) return reject('VOLUME_INVALID');
    if (!assets.has(activeId) && assets.size >= maxAssets) return reject('ACTIVE_ID_CAPACITY_REACHED');

    const receivedAtMs = now();
    const record = Object.freeze({
      activeId,
      size: finite(msg.size) && Number(msg.size) > 0 ? Number(msg.size) : null,
      candleId: finite(msg.id) && Number.isSafeInteger(Number(msg.id)) ? Number(msg.id) : null,
      atRaw: finite(msg.at) ? Number(msg.at) : null,
      fromRaw: finite(msg.from) ? Number(msg.from) : null,
      toRaw: finite(msg.to) ? Number(msg.to) : null,
      timestampUnit: 'UNVERIFIED',
      open,
      high,
      low,
      close,
      bid,
      ask,
      volume: finite(msg.volume) ? Number(msg.volume) : 0,
      phase: typeof msg.phase === 'string' ? msg.phase.slice(0, 40) : null,
      receivedAtMs,
      serverTimeRaw,
      serverTimeReceivedAt
    });
    assets.set(activeId, record);
    lastMessageAt = receivedAtMs;
    acceptedMessages += 1;
    lastRejectReason = null;
    return Object.freeze({ accepted: true, kind: 'candle-generated', activeId });
  }

  function getAsset(activeId) {
    return assets.get(Number(activeId)) ?? null;
  }

  function getSnapshot() {
    const currentTime = now();
    return Object.freeze({
      version: AVALON_READONLY_FEED_VERSION,
      mode: 'SHADOW_ONLY',
      state: assets.size ? 'RECEIVING' : 'WAITING',
      serverTimeRaw,
      serverTimeReceivedAt,
      lastMessageAt,
      ageMs: lastMessageAt === null ? null : Math.max(0, currentTime - lastMessageAt),
      acceptedMessages,
      rejectedMessages,
      ignoredMessages,
      lastRejectReason,
      activeIds: Object.freeze([...assets.keys()].sort((a, b) => a - b)),
      assets: Object.freeze([...assets.values()].sort((a, b) => a.activeId - b.activeId))
    });
  }

  function health() {
    const snapshot = getSnapshot();
    return Object.freeze({
      version: snapshot.version,
      mode: snapshot.mode,
      state: snapshot.state,
      activeAssets: snapshot.activeIds.length,
      activeIds: snapshot.activeIds,
      lastMessageAt: snapshot.lastMessageAt,
      ageMs: snapshot.ageMs,
      serverTimeRaw: snapshot.serverTimeRaw,
      acceptedMessages: snapshot.acceptedMessages,
      rejectedMessages: snapshot.rejectedMessages,
      ignoredMessages: snapshot.ignoredMessages,
      lastRejectReason: snapshot.lastRejectReason,
      latestQuotes: Object.freeze(snapshot.assets.map((asset) => Object.freeze({
        activeId: asset.activeId,
        bid: asset.bid,
        ask: asset.ask,
        close: asset.close,
        phase: asset.phase,
        receivedAtMs: asset.receivedAtMs,
        ageMs: Math.max(0, currentTime - asset.receivedAtMs)
      }))),
      decisionImpact: 'NONE',
      ordersExecuted: 0
    });
  }

  return Object.freeze({ ingest, getAsset, getSnapshot, health });
}
