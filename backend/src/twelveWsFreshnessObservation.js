import { evaluateTwelveWsEventFreshness } from './twelveWsEventFreshness.js';
import { diagnoseTwelveWsTimestampProgression } from './twelveWsTimestampProgression.js';

export const TWELVE_WS_FRESHNESS_OBSERVATION_VERSION = 'twelve-ws-freshness-observation-v1';
export const TWELVE_WS_NATIVE_EVENT_TIMESTAMP_UNIT = 'UNIX_SECONDS';
const OFFICIAL_ENDPOINT = 'wss://ws.twelvedata.com/v1/quotes/price';
const SUBSCRIBE = Object.freeze({ action: 'subscribe', params: Object.freeze({ symbols: 'EUR/USD' }) });
const HEARTBEAT = Object.freeze({ action: 'heartbeat' });
const symbols = (value) => Array.isArray(value) ? value.map((item) => String(item?.symbol ?? item).toUpperCase()) : [];
const nativeTimers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval };

function aggregateFreshness(samples) {
  const counts = { PASS: 0, FAIL: 0, DATA_INVALID: 0, UNVERIFIED: 0 };
  for (const sample of samples) counts[sample.freshnessGate] += 1;
  const ages = samples.map((sample) => sample.eventAgeMs).filter((age) => Number.isSafeInteger(age) && age >= 0);
  const representative = samples.find((sample) => sample.freshnessGate === 'DATA_INVALID') ??
    samples.filter((sample) => sample.freshnessGate === 'FAIL').sort((a, b) => b.eventAgeMs - a.eventAgeMs)[0] ??
    samples.filter((sample) => sample.freshnessGate === 'PASS').sort((a, b) => b.eventAgeMs - a.eventAgeMs)[0] ??
    samples.find((sample) => sample.freshnessGate === 'UNVERIFIED') ??
    evaluateTwelveWsEventFreshness({});
  const classification = counts.DATA_INVALID ? 'FRESHNESS_DATA_INVALID' : counts.FAIL ? 'FRESHNESS_CONTRACT_FAILED' :
    counts.PASS ? 'FRESHNESS_PASS_OBSERVED' : samples.length ? 'FRESHNESS_UNVERIFIED' : 'NO_QUOTE_OBSERVED';
  return { freshnessSamplesObserved: samples.length, freshnessPassCount: counts.PASS, freshnessFailCount: counts.FAIL,
    freshnessInvalidCount: counts.DATA_INVALID, freshnessUnverifiedCount: counts.UNVERIFIED,
    minEventAgeMs: ages.length ? Math.min(...ages) : null, maxEventAgeMs: ages.length ? Math.max(...ages) : null,
    lastEventAgeMs: ages.length && Number.isSafeInteger(samples.at(-1)?.eventAgeMs) ? samples.at(-1).eventAgeMs : null,
    classification, freshnessEvidence: representative };
}

export async function observeTwelveWsEventFreshness({ endpoint = OFFICIAL_ENDPOINT, apiKey, authorization,
  allowLocalSynthetic = false, observationWindowMs = 60_000, preAcceptTimeoutMs = 5_000,
  heartbeatIntervalMs = 10_000, eventTimestampUnit = TWELVE_WS_NATIVE_EVENT_TIMESTAMP_UNIT,
  now = () => Date.now(), timers = nativeTimers, webSocketFactory = (url) => new globalThis.WebSocket(url) } = {}) {
  const target = new URL(endpoint); const local = ['localhost', '127.0.0.1', '::1'].includes(target.hostname);
  const externalAuthorizations = new Set(['R8H_FRESHNESS_OBSERVATION_EXPLICITLY_AUTHORIZED', 'R8I_TIMESTAMP_PROGRESSION_EXPLICITLY_AUTHORIZED']);
  const external = endpoint === OFFICIAL_ENDPOINT && externalAuthorizations.has(authorization);
  if (!(allowLocalSynthetic && local) && !external) throw new Error('FRESHNESS_OBSERVATION_NOT_AUTHORIZED');
  if (!apiKey) throw new Error('FRESHNESS_OBSERVATION_KEY_MISSING');
  if (!Number.isFinite(preAcceptTimeoutMs) || preAcceptTimeoutMs < 100 || preAcceptTimeoutMs > 5_000) throw new Error('FRESHNESS_PRE_ACCEPT_TIMEOUT_INVALID');
  if (!Number.isFinite(observationWindowMs) || observationWindowMs < 100 || observationWindowMs > 60_000) throw new Error('FRESHNESS_OBSERVATION_WINDOW_INVALID');
  if (!Number.isFinite(heartbeatIntervalMs) || heartbeatIntervalMs < 10_000) throw new Error('FRESHNESS_HEARTBEAT_INTERVAL_INVALID');
  const effectiveTimestampUnit = external ? TWELVE_WS_NATIVE_EVENT_TIMESTAMP_UNIT : eventTimestampUnit;
  target.search = ''; target.searchParams.set('apikey', apiKey);
  const state = { connections: 0, subscribeAttempts: 0, subscribeAccepted: false, quoteMessagesObserved: 0,
    observationWindowMs, preAcceptTimeoutMs, heartbeatIntervalMs, heartbeatsSent: 0, closeCode: null,
    retries: 0, reconnects: 0, redirects: 0, applicationMessagesSent: 0 };
  return new Promise((resolve) => {
    let settled = false; let socket; let deadline; let heartbeatTimer; const samples = []; const nativeEventTimestamps = [];
    const finish = (terminalClassification = null) => {
      if (settled) return; settled = true; timers.clearTimeout(deadline); timers.clearInterval(heartbeatTimer);
      const aggregate = aggregateFreshness(samples);
      const progression = diagnoseTwelveWsTimestampProgression(nativeEventTimestamps, effectiveTimestampUnit);
      const report = Object.freeze({ observationVersion: TWELVE_WS_FRESHNESS_OBSERVATION_VERSION, ...state, ...aggregate, ...progression,
        classification: terminalClassification ?? aggregate.classification, providerCommissioning: false, decisionImpact: 'NONE',
        prospectivePaperAuthorized: false, ordersExecuted: 0, externalProviderCalls: external ? state.connections : 0,
        restRequests: 0, saxoRequests: 0, secretExposed: false });
      try { socket?.close(); } catch {} resolve(report);
    };
    try { socket = webSocketFactory(target.toString()); } catch { finish('TRANSPORT_OR_PROTOCOL_INCONCLUSIVE'); return; }
    deadline = timers.setTimeout(() => finish('PRE_ACCEPT_TIMEOUT'), preAcceptTimeoutMs);
    socket.addEventListener('open', () => {
      if (settled || state.subscribeAttempts) return; state.connections = 1; state.subscribeAttempts = 1;
      state.applicationMessagesSent = 1; socket.send(JSON.stringify(SUBSCRIBE));
    });
    socket.addEventListener('message', (event) => {
      if (settled) return; let payload;
      try { payload = JSON.parse(typeof event?.data === 'string' ? event.data : String(event?.data ?? '')); } catch { return; }
      if (payload?.event === 'subscribe-status') {
        if (!symbols(payload.success).includes('EUR/USD') || symbols(payload.fails ?? payload.failed).includes('EUR/USD') || payload.status === 'error') { finish('SUBSCRIBE_NOT_ACCEPTED'); return; }
        if (state.subscribeAccepted) return; state.subscribeAccepted = true; timers.clearTimeout(deadline);
        deadline = timers.setTimeout(() => finish(), observationWindowMs);
        heartbeatTimer = timers.setInterval(() => { if (settled) return; socket.send(JSON.stringify(HEARTBEAT)); state.heartbeatsSent += 1; state.applicationMessagesSent += 1; }, heartbeatIntervalMs);
        return;
      }
      if (payload?.event === 'price' && String(payload?.symbol ?? '').toUpperCase() === 'EUR/USD' && state.subscribeAccepted) {
        const receiveTimestamp = now(); state.quoteMessagesObserved += 1;
        nativeEventTimestamps.push(payload.timestamp);
        samples.push(evaluateTwelveWsEventFreshness({ eventTimestamp: payload.timestamp,
          eventTimestampUnit: effectiveTimestampUnit, receiveTimestamp, receiveTimestampUnit: 'UNIX_MILLISECONDS' }));
      }
    });
    socket.addEventListener('error', () => finish('TRANSPORT_OR_PROTOCOL_INCONCLUSIVE'));
    socket.addEventListener('close', (event) => { if (settled) return; state.closeCode = Number.isFinite(Number(event?.code)) ? Number(event.code) : null; finish('ABNORMAL_CLOSE'); });
  });
}
