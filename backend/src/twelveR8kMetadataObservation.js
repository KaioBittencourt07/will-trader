export const TWELVE_R8K_METADATA_OBSERVATION_VERSION = 'twelve-r8k-metadata-observation-v1';
export const TWELVE_R8K_METADATA_AUTHORIZATION = 'R8K_TIMESTAMP_SEMANTICS_EXPLICITLY_AUTHORIZED';

const OFFICIAL_ENDPOINT = 'wss://ws.twelvedata.com/v1/quotes/price';
const HEARTBEAT = Object.freeze({ action: 'heartbeat' });
const nativeTimers = Object.freeze({
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval
});

function normalizeSymbols(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item?.symbol ?? item).toUpperCase())
    : [];
}

function metadataFromState(state) {
  const timestamps = state.nativeTimestamps;
  let timestampAdvanceCount = 0;
  let timestampRegressionCount = 0;
  let arrivalAdvanceCount = 0;
  let arrivalRegressionCount = 0;
  const positiveTimestampSteps = [];

  for (let index = 1; index < timestamps.length; index += 1) {
    const nativeStepMs = (timestamps[index] - timestamps[index - 1]) * 1_000;
    const arrivalStepMs = state.arrivalTimestamps[index] - state.arrivalTimestamps[index - 1];
    if (nativeStepMs > 0) {
      timestampAdvanceCount += 1;
      positiveTimestampSteps.push(nativeStepMs);
    } else if (nativeStepMs < 0) timestampRegressionCount += 1;
    if (arrivalStepMs > 0) arrivalAdvanceCount += 1;
    else if (arrivalStepMs < 0) arrivalRegressionCount += 1;
  }

  const distinct = new Set(timestamps).size;
  return Object.freeze({
    eventFieldPresent: state.eventFieldPresent,
    symbolFieldPresent: state.symbolFieldPresent,
    timestampFieldPresent: state.timestampFieldPresent,
    timestampFinite: state.timestampFinite,
    timestampUnitObserved: 'UNIX_SECONDS_DESCRIPTIVE_ONLY',
    timestampDistinctCount: distinct,
    timestampAdvanceCount,
    timestampRegressionCount,
    repeatedTimestampCount: timestamps.length - distinct,
    minPositiveTimestampStepMs: positiveTimestampSteps.length ? Math.min(...positiveTimestampSteps) : null,
    maxPositiveTimestampStepMs: positiveTimestampSteps.length ? Math.max(...positiveTimestampSteps) : null,
    arrivalAdvanceCount,
    arrivalRegressionCount,
    rawPayloadRetained: false,
    rawPriceRetained: false,
    rawTimestampRetained: false
  });
}

export async function observeTwelveR8kMetadata({
  endpoint = OFFICIAL_ENDPOINT,
  apiKey,
  authorization,
  symbol = 'EUR/USD',
  observationWindowMs = 60_000,
  preAcceptTimeoutMs = 5_000,
  heartbeatIntervalMs = 10_000,
  metadataOnly = true,
  now = () => Date.now(),
  timers = nativeTimers,
  webSocketFactory = (url) => new globalThis.WebSocket(url)
} = {}) {
  if (endpoint !== OFFICIAL_ENDPOINT || authorization !== TWELVE_R8K_METADATA_AUTHORIZATION) {
    throw new Error('R8K_METADATA_OBSERVATION_NOT_AUTHORIZED');
  }
  if (!apiKey) throw new Error('R8K_METADATA_KEY_MISSING');
  if (symbol !== 'EUR/USD') throw new Error('R8K_METADATA_SYMBOL_INVALID');
  if (metadataOnly !== true) throw new Error('R8K_METADATA_ONLY_REQUIRED');
  if (preAcceptTimeoutMs !== 5_000 || observationWindowMs !== 60_000 || heartbeatIntervalMs < 10_000) {
    throw new Error('R8K_METADATA_BOUNDS_INVALID');
  }

  const target = new URL(endpoint);
  target.search = '';
  target.searchParams.set('apikey', apiKey);
  const subscribe = Object.freeze({ action: 'subscribe', params: Object.freeze({ symbols: symbol }) });

  const state = {
    connections: 0,
    subscribeAttempts: 0,
    subscribeAccepted: false,
    retries: 0,
    reconnects: 0,
    redirects: 0,
    restRequests: 0,
    observationWindowMs,
    preAcceptTimeoutMs,
    heartbeatIntervalMs,
    externalProviderCalls: 0,
    eventFieldPresent: false,
    symbolFieldPresent: false,
    timestampFieldPresent: false,
    timestampFinite: true,
    nativeTimestamps: [],
    arrivalTimestamps: []
  };

  return new Promise((resolve) => {
    let socket;
    let deadline;
    let heartbeatTimer;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      timers.clearTimeout(deadline);
      timers.clearInterval(heartbeatTimer);
      const metadata = metadataFromState(state);
      try { socket?.close(); } catch {}
      resolve(Object.freeze({
        observationVersion: TWELVE_R8K_METADATA_OBSERVATION_VERSION,
        connections: state.connections,
        subscribeAttempts: state.subscribeAttempts,
        subscribeAccepted: state.subscribeAccepted,
        retries: 0,
        reconnects: 0,
        redirects: 0,
        restRequests: 0,
        observationWindowMs,
        preAcceptTimeoutMs,
        heartbeatIntervalMs,
        externalProviderCalls: state.externalProviderCalls,
        metadata,
        providerCommissioning: false,
        decisionImpact: 'NONE',
        prospectivePaperAuthorized: false,
        ordersExecuted: 0,
        secretExposed: false
      }));
    };

    try {
      socket = webSocketFactory(target.toString());
      state.externalProviderCalls = 1;
    } catch {
      finish();
      return;
    }

    deadline = timers.setTimeout(finish, preAcceptTimeoutMs);

    socket.addEventListener('open', () => {
      if (settled || state.subscribeAttempts) return;
      state.connections = 1;
      state.subscribeAttempts = 1;
      socket.send(JSON.stringify(subscribe));
    });

    socket.addEventListener('message', (event) => {
      if (settled) return;
      let payload;
      try {
        payload = JSON.parse(typeof event?.data === 'string' ? event.data : String(event?.data ?? ''));
      } catch {
        return;
      }

      if (payload?.event === 'subscribe-status') {
        const success = normalizeSymbols(payload.success);
        const failed = normalizeSymbols(payload.fails ?? payload.failed);
        if (!success.includes(symbol) || failed.includes(symbol) || payload.status === 'error') {
          finish();
          return;
        }
        if (state.subscribeAccepted) return;
        state.subscribeAccepted = true;
        timers.clearTimeout(deadline);
        deadline = timers.setTimeout(finish, observationWindowMs);
        heartbeatTimer = timers.setInterval(() => {
          if (!settled) socket.send(JSON.stringify(HEARTBEAT));
        }, heartbeatIntervalMs);
        return;
      }

      if (payload?.event === 'price' && String(payload?.symbol ?? '').toUpperCase() === symbol && state.subscribeAccepted) {
        state.eventFieldPresent ||= Object.hasOwn(payload, 'event');
        state.symbolFieldPresent ||= Object.hasOwn(payload, 'symbol');
        state.timestampFieldPresent ||= Object.hasOwn(payload, 'timestamp');
        if (!Number.isFinite(payload.timestamp)) {
          state.timestampFinite = false;
          return;
        }
        state.nativeTimestamps.push(payload.timestamp);
        state.arrivalTimestamps.push(now());
      }
    });

    socket.addEventListener('error', finish);
    socket.addEventListener('close', finish);
  });
}
