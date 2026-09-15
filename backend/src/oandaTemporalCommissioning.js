import { qualifyTemporalAuthorityObservation } from './temporalAuthorityProvider.js';

export const OANDA_TEMPORAL_COMMISSIONING_VERSION = 'oanda-temporal-commissioning-v1';
export const OANDA_TEMPORAL_MAX_CALLS = 8;
export const OANDA_TEMPORAL_DEFAULT_OBSERVATIONS = 6;
export const OANDA_TEMPORAL_DEFAULT_INTERVAL_MS = 1_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const finiteTime = (value) => Number.isFinite(Date.parse(value ?? ''));
const midpoint = (entry = {}) => {
  const bid = Number(entry.closeoutBid);
  const ask = Number(entry.closeoutAsk);
  return Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0 ? (bid + ask) / 2 : null;
};

export function analyzeOandaTemporalObservations(observations = [], { now = Date.now(), maximumAllowedSkewMs = 5_000 } = {}) {
  const accepted = [];
  let repeatedTimestampPriceChanges = 0;
  let timestampRegressions = 0;
  let duplicates = 0;
  let previous = null;
  let maxAbsEventReceiveSkewMs = null;
  let minEventReceiveSkewMs = null;
  let maxEventReceiveSkewMs = null;

  for (const observation of observations) {
    const eventTimestamp = Number(observation?.eventTimestamp);
    const receivedAtMs = Date.parse(observation?.receivedAt ?? '');
    const price = Number(observation?.price);
    if (!Number.isFinite(eventTimestamp) || !Number.isFinite(receivedAtMs) || !Number.isFinite(price) || price <= 0) continue;

    if (previous && previous.eventTimestamp === eventTimestamp && previous.price === price) {
      duplicates += 1;
      continue;
    }
    if (previous && eventTimestamp < previous.eventTimestamp) timestampRegressions += 1;
    if (previous && previous.eventTimestamp === eventTimestamp && previous.price !== price) repeatedTimestampPriceChanges += 1;

    const skew = receivedAtMs - eventTimestamp;
    const absSkew = Math.abs(skew);
    maxAbsEventReceiveSkewMs = maxAbsEventReceiveSkewMs === null ? absSkew : Math.max(maxAbsEventReceiveSkewMs, absSkew);
    minEventReceiveSkewMs = minEventReceiveSkewMs === null ? skew : Math.min(minEventReceiveSkewMs, skew);
    maxEventReceiveSkewMs = maxEventReceiveSkewMs === null ? skew : Math.max(maxEventReceiveSkewMs, skew);
    accepted.push({ eventTimestamp, receivedAt: new Date(receivedAtMs).toISOString(), price });
    previous = { eventTimestamp, price };
  }

  const distinctEventTimestamps = new Set(accepted.map((item) => item.eventTimestamp)).size;
  const enoughObservations = accepted.length >= 3;
  const timestampProgresses = distinctEventTimestamps >= 2;
  const receiveClockCoherent = maxAbsEventReceiveSkewMs !== null && maxAbsEventReceiveSkewMs <= maximumAllowedSkewMs;
  const coarseTimestampObserved = repeatedTimestampPriceChanges > 0;
  const perEventSemanticsVerified = enoughObservations
    && timestampProgresses
    && timestampRegressions === 0
    && !coarseTimestampObserved
    && receiveClockCoherent;

  const latest = accepted.at(-1) ?? null;
  const authority = latest
    ? qualifyTemporalAuthorityObservation({
        provider: 'oanda-practice-pricing',
        symbol: 'EUR/USD',
        eventTimestamp: latest.eventTimestamp,
        receivedAt: latest.receivedAt,
        timestampAuthority: 'OANDA_PRICING_EVENT_TIME',
        provenanceVerified: true,
        perEventSemanticsVerified,
        now,
        maxAgeMs: 30_000
      })
    : null;

  return Object.freeze({
    version: OANDA_TEMPORAL_COMMISSIONING_VERSION,
    provider: 'oanda-practice-pricing',
    symbol: 'EUR/USD',
    endpointRole: 'READONLY_TEMPORAL_AUTHORITY_CANDIDATE',
    acceptedObservations: accepted.length,
    duplicateObservations: duplicates,
    distinctEventTimestamps,
    repeatedTimestampPriceChanges,
    timestampRegressions,
    maxAbsEventReceiveSkewMs,
    minEventReceiveSkewMs,
    maxEventReceiveSkewMs,
    maximumAllowedEventReceiveSkewMs: maximumAllowedSkewMs,
    enoughObservations,
    timestampProgresses,
    receiveClockCoherent,
    coarseTimestampObserved,
    provenanceVerified: true,
    perEventSemanticsVerified,
    temporalAuthority: authority,
    rawSequenceStored: false,
    decisionImpact: authority?.decisionImpact ?? 'NONE',
    prospectivePaperAuthorized: false,
    ordersExecuted: 0
  });
}

export async function runOandaTemporalCommissioning({
  token,
  accountId,
  fetchImpl = fetch,
  now = () => Date.now(),
  wait = sleep,
  observations = OANDA_TEMPORAL_DEFAULT_OBSERVATIONS,
  intervalMs = OANDA_TEMPORAL_DEFAULT_INTERVAL_MS,
  maximumAllowedSkewMs = 5_000
} = {}) {
  if (!token || !accountId) {
    return Object.freeze({
      version: OANDA_TEMPORAL_COMMISSIONING_VERSION,
      result: 'BLOCKED_CONFIGURATION',
      reasonCodes: [!token ? 'OANDA_TOKEN_MISSING' : null, !accountId ? 'OANDA_ACCOUNT_ID_MISSING' : null].filter(Boolean),
      externalCalls: 0,
      secretExposed: false,
      decisionImpact: 'NONE',
      prospectivePaperAuthorized: false,
      ordersExecuted: 0
    });
  }

  const requested = Math.min(OANDA_TEMPORAL_MAX_CALLS, Math.max(3, Number(observations) || OANDA_TEMPORAL_DEFAULT_OBSERVATIONS));
  const boundedInterval = Math.min(5_000, Math.max(250, Number(intervalMs) || OANDA_TEMPORAL_DEFAULT_INTERVAL_MS));
  const samples = [];
  let externalCalls = 0;

  for (let index = 0; index < requested; index += 1) {
    externalCalls += 1;
    let response;
    try {
      response = await fetchImpl(`https://api-fxpractice.oanda.com/v3/accounts/${encodeURIComponent(accountId)}/pricing?instruments=EUR_USD`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000)
      });
    } catch (error) {
      return Object.freeze({
        version: OANDA_TEMPORAL_COMMISSIONING_VERSION,
        result: 'BLOCKED_EXTERNAL',
        reasonCodes: ['OANDA_NETWORK_ERROR'],
        externalCalls,
        secretExposed: false,
        decisionImpact: 'NONE',
        prospectivePaperAuthorized: false,
        ordersExecuted: 0
      });
    }

    if (!response?.ok) {
      return Object.freeze({
        version: OANDA_TEMPORAL_COMMISSIONING_VERSION,
        result: 'BLOCKED_EXTERNAL',
        reasonCodes: [`OANDA_HTTP_${response?.status ?? 'UNKNOWN'}`],
        externalCalls,
        secretExposed: false,
        decisionImpact: 'NONE',
        prospectivePaperAuthorized: false,
        ordersExecuted: 0
      });
    }

    const payload = await response.json();
    const entry = payload?.prices?.find((item) => item?.instrument === 'EUR_USD');
    const price = midpoint(entry);
    const eventTimestamp = finiteTime(entry?.time) ? Date.parse(entry.time) : null;
    const receivedAt = new Date(now()).toISOString();
    samples.push({ eventTimestamp, receivedAt, price });
    if (index + 1 < requested) await wait(boundedInterval);
  }

  const analysis = analyzeOandaTemporalObservations(samples, { now: now(), maximumAllowedSkewMs });
  const approved = analysis.perEventSemanticsVerified === true
    && analysis.temporalAuthority?.authorityGate === 'PASS'
    && analysis.temporalAuthority?.freshnessGate === 'PASS';

  return Object.freeze({
    ...analysis,
    result: approved ? 'TEMPORAL_AUTHORITY_APPROVED_READONLY' : 'TEMPORAL_AUTHORITY_BLOCKED',
    externalCalls,
    requestedObservations: requested,
    intervalMs: boundedInterval,
    secretExposed: false
  });
}
