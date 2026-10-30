import { createBlsCalendarAdapter } from '../../context/src/adapters/blsCalendarAdapter.js';
import { createFedCalendarAdapter } from '../../context/src/adapters/fedCalendarAdapter.js';
import { createGdeltNewsAdapter } from '../../context/src/adapters/gdeltNewsAdapter.js';

function eventSummary(snapshot = {}) {
  const events = Array.isArray(snapshot.events) ? snapshot.events : [];
  const times = events.map((event) => Date.parse(event.timestamp)).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    source: snapshot.source ?? null,
    acceptedEvents: events.length,
    highImpactEvents: events.filter((event) => event.impact === 'HIGH').length,
    earliestEventTimestamp: times.length ? new Date(times[0]).toISOString() : null,
    latestEventTimestamp: times.length ? new Date(times[times.length - 1]).toISOString() : null
  };
}

function newsSummary(snapshot = {}) {
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  const times = items.map((item) => Date.parse(item.timestamp)).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    source: snapshot.source ?? null,
    acceptedItems: items.length,
    verifiedTimestampedItems: items.filter((item) => item.verified && Number.isFinite(Date.parse(item.timestamp))).length,
    earliestItemTimestamp: times.length ? new Date(times[0]).toISOString() : null,
    latestItemTimestamp: times.length ? new Date(times[times.length - 1]).toISOString() : null,
    discoveryOnly: snapshot.discoveryOnly === true,
    hardBlockEligible: snapshot.hardBlockEligible === true
  };
}

function classifyObservationError(error) {
  const text = String(error ?? 'UNKNOWN').slice(0, 240);
  if (text.includes('RATE_LIMIT')) return { error: text, errorClass: 'RATE_LIMITED', retryRecommended: false };
  if (/timeout|aborted/i.test(text)) return { error: text, errorClass: 'TIMEOUT', retryRecommended: false };
  if (/HTTP_\d+/.test(text)) return { error: text, errorClass: 'HTTP_ERROR', retryRecommended: false };
  return { error: text, errorClass: 'UNQUALIFIED_SOURCE_ERROR', retryRecommended: false };
}

async function observe(label, task) {
  try {
    const snapshot = await task();
    return { label, ok: true, snapshot };
  } catch (error) {
    return { label, ok: false, ...classifyObservationError(error?.message || error) };
  }
}

export async function commissionMarketIntelligenceReadOnly({ fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const bls = createBlsCalendarAdapter({ fetchImpl, now });
  const fed = createFedCalendarAdapter({ fetchImpl, now });
  const gdelt = createGdeltNewsAdapter({ fetchImpl, now, timespan: '60min', maxrecords: 20 });

  // Exactly one bounded GET per source/endpoint in this commissioning run.
  const observations = [];
  observations.push(await observe('BLS_CALENDAR', () => bls.getSnapshot()));
  observations.push(await observe('FED_MONTHLY_CALENDAR', () => fed.getSnapshot()));
  observations.push(await observe('GDELT_DOC', () => gdelt.getSnapshot()));

  const blsResult = observations.find((item) => item.label === 'BLS_CALENDAR');
  const fedResult = observations.find((item) => item.label === 'FED_MONTHLY_CALENDAR');
  const gdeltResult = observations.find((item) => item.label === 'GDELT_DOC');

  const macroApproved = Boolean(blsResult?.ok && fedResult?.ok
    && blsResult.snapshot.events?.length > 0
    && fedResult.snapshot.events?.some((event) => event.name === 'FOMC' && event.impact === 'HIGH'));
  const newsApproved = Boolean(gdeltResult?.ok
    && gdeltResult.snapshot.items?.some((item) => item.verified && Number.isFinite(Date.parse(item.timestamp))));

  const status = macroApproved && newsApproved
    ? 'APPROVED'
    : macroApproved || newsApproved
      ? 'PARTIAL'
      : 'BLOCKED';

  return {
    version: 'will-market-intelligence-commission-v2',
    status,
    macroApproved,
    newsApproved,
    coverage: status === 'APPROVED' ? 'FULL' : status === 'PARTIAL' ? 'PARTIAL' : 'UNKNOWN',
    sourcePolicy: {
      macro: 'OFFICIAL_SOURCE_CAN_QUALIFY_HARD_RISK_WINDOWS',
      news: 'DISCOVERY_ONLY_UNTIL_PRIMARY_SOURCE_OR_EXPLICIT_IMPACT_POLICY',
      unavailableNewsDoesNotBecomeSafe: true
    },
    requestBudget: 3,
    requestsMade: 3,
    observations: {
      bls: blsResult?.ok ? eventSummary(blsResult.snapshot) : { source: 'BLS_OFFICIAL_RELEASE_CALENDAR', error: blsResult?.error ?? 'UNKNOWN', errorClass: blsResult?.errorClass ?? 'UNKNOWN', retryRecommended: false },
      fed: fedResult?.ok ? eventSummary(fedResult.snapshot) : { source: 'FEDERAL_RESERVE_OFFICIAL_CALENDAR', error: fedResult?.error ?? 'UNKNOWN', errorClass: fedResult?.errorClass ?? 'UNKNOWN', retryRecommended: false },
      gdelt: gdeltResult?.ok ? newsSummary(gdeltResult.snapshot) : { source: 'GDELT_DOC_2_ARTICLE_LIST', error: gdeltResult?.error ?? 'UNKNOWN', errorClass: gdeltResult?.errorClass ?? 'UNKNOWN', retryRecommended: false }
    },
    rawEventsExposed: false,
    rawArticlesExposed: false,
    secretRequired: false,
    decisionImpact: 'NONE',
    ordersExecuted: 0
  };
}

const direct = process.argv[1] && new URL(import.meta.url).pathname.replace(/^\/[A-Za-z]:/, (value) => value.slice(1)).replace(/\//g, process.platform === 'win32' ? '\\' : '/') === process.argv[1];
if (direct) {
  commissionMarketIntelligenceReadOnly()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(JSON.stringify({ status: 'BLOCKED', error: String(error?.message || error), decisionImpact: 'NONE', ordersExecuted: 0 }, null, 2));
      process.exitCode = 1;
    });
}
