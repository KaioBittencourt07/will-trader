export const TWELVE_WS_EVENT_FRESHNESS_VERSION = 'twelve-ws-event-freshness-v1';
export const TWELVE_WS_FRESHNESS_CONTRACT_MS = 30_000;
const UNITS = Object.freeze({ UNIX_SECONDS: 1_000, UNIX_MILLISECONDS: 1 });

export function evaluateTwelveWsEventFreshness(input = {}) {
  const safeInput = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const { eventTimestamp, eventTimestampUnit, receiveTimestamp, receiveTimestampUnit } = safeInput;
  const base = { freshnessVersion: TWELVE_WS_EVENT_FRESHNESS_VERSION,
    eventTimestampObserved: eventTimestamp !== undefined && eventTimestamp !== null,
    receiveTimestampObserved: receiveTimestamp !== undefined && receiveTimestamp !== null,
    eventAgeMs: null, freshnessContractMs: TWELVE_WS_FRESHNESS_CONTRACT_MS,
    freshnessGate: 'UNVERIFIED', blocker: null, clockComparabilityGate: 'UNVERIFIED',
    timestampUnitGate: 'UNVERIFIED', futureTimestampGate: 'UNVERIFIED', providerCommissioning: false,
    decisionImpact: 'NONE', prospectivePaperAuthorized: false, ordersExecuted: 0, externalProviderCalls: 0 };
  const finish = (changes) => Object.freeze({ ...base, ...changes });
  if (Object.keys(safeInput).some((key) => !['eventTimestamp', 'eventTimestampUnit', 'receiveTimestamp', 'receiveTimestampUnit'].includes(key))) return finish({ freshnessGate: 'DATA_INVALID', blocker: 'UNSANITIZED_INPUT' });
  if (!base.eventTimestampObserved) return finish({ blocker: 'EVENT_TIMESTAMP_MISSING' });
  if (!base.receiveTimestampObserved) return finish({ blocker: 'RECEIVE_TIMESTAMP_MISSING' });
  if (!Number.isFinite(eventTimestamp) || !Number.isFinite(receiveTimestamp)) return finish({ freshnessGate: 'DATA_INVALID', blocker: 'TIMESTAMP_NOT_FINITE' });
  if (!UNITS[eventTimestampUnit] || !UNITS[receiveTimestampUnit]) return finish({ freshnessGate: 'DATA_INVALID', blocker: 'TIMESTAMP_UNIT_AMBIGUOUS', timestampUnitGate: 'FAIL' });
  const eventMs = eventTimestamp * UNITS[eventTimestampUnit]; const receiveMs = receiveTimestamp * UNITS[receiveTimestampUnit];
  if (!Number.isSafeInteger(eventMs) || !Number.isSafeInteger(receiveMs)) return finish({ freshnessGate: 'DATA_INVALID', blocker: 'TIMESTAMP_NOT_SAFE_INTEGER', timestampUnitGate: 'PASS', clockComparabilityGate: 'FAIL' });
  const age = receiveMs - eventMs;
  if (age < 0) return finish({ freshnessGate: 'DATA_INVALID', blocker: 'EVENT_TIMESTAMP_IN_FUTURE', timestampUnitGate: 'PASS', clockComparabilityGate: 'PASS', futureTimestampGate: 'FAIL' });
  return finish({ eventAgeMs: age, freshnessGate: age <= TWELVE_WS_FRESHNESS_CONTRACT_MS ? 'PASS' : 'FAIL',
    blocker: age <= TWELVE_WS_FRESHNESS_CONTRACT_MS ? null : 'EVENT_OLDER_THAN_FROZEN_CONTRACT',
    timestampUnitGate: 'PASS', clockComparabilityGate: 'PASS', futureTimestampGate: 'PASS' });
}
