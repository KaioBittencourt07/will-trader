import fs from 'node:fs';
import path from 'node:path';
import { expiryAt } from '../../learning/src/outcomeResolver.js';

export const COMMISSIONING_VERSION = 'paper-final-commissioning-v1';
export const REFERENCE_DEADLINE_MS = 30_000;
export const CYCLE_REASONS = Object.freeze([
  'NO_SIGNAL', 'DEDUPLICATED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_COOLDOWN',
  'STALE_DATA', 'MARKET_DATA_INVALID', 'ADMISSION_REJECTED', 'WAIT_DECISION',
  'NO_EXECUTABLE_CANDIDATE', 'OTHER_SANITIZED_REASON'
]);
const REASON_SET = new Set(CYCLE_REASONS);
const REFERENCE_REASONS = new Set([
  'PAPER_ENTRY_REFERENCE_WINDOW_MISSED', 'PAPER_EXIT_REFERENCE_WINDOW_MISSED',
  'PAPER_ENTRY_TIME_INVALID', 'EXPIRY_NOT_RESOLVABLE', 'INVALID_REFERENCE_TIMESTAMP',
  'INVALID_RESOLUTION_PRICE'
]);
const safeId = value => typeof value === 'string' && /^autonomous-paper-monitor-v1:\d+:[A-Z0-9/]+:[a-f0-9]{12}$/.test(value) ? value : null;
const safeCycle = value => typeof value === 'string' && /^autonomous-paper-monitor-v1:\d+$/.test(value) ? value : null;
const safeAsset = value => typeof value === 'string' && /^[A-Z0-9]{2,10}\/\w{2,10}$/.test(value) ? value : null;
const safeSource = value => ['twelvedata-closed-ohlc+biquote-forex-tick','twelvedata-closed-ohlc+coinbase-exchange-ticker','twelvedata','local-relay'].includes(value)
  ? value : 'OTHER_SANITIZED_SOURCE';
const safeHealth = value => ['BIQUOTE_TEMPORAL+TWELVE_CLOSED_OHLC','COINBASE_TEMPORAL+TWELVE_CLOSED_OHLC','LOCAL_RELAY','HEALTHY'].includes(value)
  ? value : 'UNKNOWN';
const timestamp = value => Number.isFinite(Date.parse(value ?? '')) ? new Date(Date.parse(value)).toISOString() : null;
const lag = (actual, target) => actual && target ? Date.parse(actual) - Date.parse(target) : null;
const count = (items, key) => items.reduce((acc, item) => {
  const name = key(item);
  if (name) acc[name] = (acc[name] ?? 0) + 1;
  return acc;
}, {});
const percentile = (items, p) => {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p, low = Math.floor(index), high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
};

export function classifyCycleReason(value) {
  const code = String(value ?? '').toUpperCase();
  if (/\bAI\b|OPENAI|ADVISOR/.test(code)) return 'OTHER_SANITIZED_REASON';
  if (/429|COOLDOWN|RATE_LIMIT/.test(code)) return 'PROVIDER_COOLDOWN';
  if (/DEDUP|DUPLICATE|FINGERPRINT/.test(code)) return 'DEDUPLICATED';
  if (/STALE|FRESHNESS|QUOTE_AGE/.test(code)) return 'STALE_DATA';
  if (/ADMISSION|CANONICAL|AUTHORITY/.test(code)) return 'ADMISSION_REJECTED';
  if (/PROVIDER|FEED|HTTP_5|NETWORK|DISCONNECT|UNAVAILABLE/.test(code)) return 'PROVIDER_UNAVAILABLE';
  if (/MALFORMED|INVALID_MARKET|INVALID_DATA|NO_SNAPSHOT|OHLC/.test(code)) return 'MARKET_DATA_INVALID';
  if (/WAIT/.test(code)) return 'WAIT_DECISION';
  if (/NO_SIGNAL/.test(code)) return 'NO_SIGNAL';
  if (/NO_EXECUTABLE/.test(code)) return 'NO_EXECUTABLE_CANDIDATE';
  return 'OTHER_SANITIZED_REASON';
}

export function summarizeOpportunityCycle(body = {}) {
  const unavailable = Array.isArray(body.unavailable) ? body.unavailable : [];
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  const reasons = {},skippedReasons={},unavailableReasons={};
  const add = (code,target) => { const safe = classifyCycleReason(code); reasons[safe] = (reasons[safe] ?? 0) + 1;
    target[safe]=(target[safe]??0)+1; };
  for (const item of unavailable) add(item.error ?? item.reason,unavailableReasons);
  for (const item of candidates) {
    if (item?.stages?.releaseEligible === false) add(item.waitCode ?? 'WAIT_DECISION',skippedReasons);
  }
  if (Number(body.scanned) === 0 && unavailable.length === 0) add('NO_SIGNAL',unavailableReasons);
  if (Number(body.scanned) > 0 && !body.recommendation && Object.keys(reasons).length === 0) add('NO_EXECUTABLE_CANDIDATE',unavailableReasons);
  return Object.freeze({ recordCount: Number.isSafeInteger(body.scanned) && body.scanned >= 0 ? body.scanned : 0,
    zeroRecord: Number(body.scanned) === 0, skippedCount: candidates.filter(c => c?.stages?.releaseEligible === false).length,
    reasons,skippedReasons,unavailableReasons });
}

function projectRecord(record) {
  const planned = timestamp(record.execution?.plannedClickTime ?? record.clickTime);
  const entry = record.execution?.status === 'PAPER_CONFIRMED' && record.execution?.paperOnly === true
    ? timestamp(record.execution.actualClickTime) : null;
  const expiryMs = expiryAt(record), expiry = Number.isFinite(expiryMs) ? new Date(expiryMs).toISOString() : null;
  const metadata = record.outcomeMetadata ?? {};
  const final = record.status === 'CLOSED' ? record.outcome === 'DATA_INVALID' ? 'DATA_INVALID' :
    ['WIN', 'LOSS', 'TIE'].includes(record.outcome) ? 'SETTLED' : 'UNKNOWN_TERMINAL' : 'PENDING';
  const exit = final === 'SETTLED' && metadata.source === 'paper-live-temporal-reference-v1'
    ? timestamp(metadata.referenceTimestamp) : null;
  const reason = REFERENCE_REASONS.has(metadata.reason) ? metadata.reason : null;
  return {
    decisionId: safeId(record.decisionId), monitorCycleId: safeCycle(record.metadata?.context?.monitorCycleId),
    asset: safeAsset(record.asset), direction: ['BUY', 'SELL'].includes(record.direction) ? record.direction : null,
    providerSource: safeSource(record.metadata?.dataQuality?.source),
    plannedClickTime: planned, firstValidTemporalReferenceTimestamp: entry,
    entryReferenceLagMs: lag(entry, planned), entryReferenceFound: Boolean(entry),
    entryReferenceDeadlineMs: REFERENCE_DEADLINE_MS,
    entryReferenceMissReason: reason?.startsWith('PAPER_ENTRY') ? reason : null,
    expiryTargetTime: expiry, expiryReferenceTimestamp: exit,
    expiryReferenceLagMs: lag(exit, expiry), expiryReferenceFound: Boolean(exit),
    initialQuoteAgeMs: Number.isFinite(record.metadata?.dataQuality?.ageMs) ? record.metadata.dataQuality.ageMs : null,
    providerHealthAtDecision: safeHealth(record.metadata?.context?.providerHealth),
    settlementFinalState: final,
    settlementMissReason: reason
  };
}

/** Private, opt-in, prospectively initialized ledger. Reconciliation reads history; it never writes it. */
export function createFinalCommissioningStore({ filePath, history = [], now = () => new Date().toISOString() } = {}) {
  if (!filePath || !Array.isArray(history)) throw new Error('COMMISSIONING_CONFIG_INVALID');
  let state;
  const persist = () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.tmp`;
    const fd = fs.openSync(temp, 'w');
    try { fs.writeFileSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temp, filePath);
  };
  if (fs.existsSync(filePath)) {
    state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (state?.schemaVersion !== COMMISSIONING_VERSION || !Array.isArray(state.baselineIds) ||
      !state.baselineIds.every(id => typeof id === 'string') || !state.entries || !state.cycles || !timestamp(state.activatedAt)) {
      throw new Error('COMMISSIONING_STATE_INVALID');
    }
  } else {
    state = { schemaVersion: COMMISSIONING_VERSION, activatedAt: timestamp(now()),
      baselineIds: history.map(r => r.id), entries: {}, cycles: {} };
    if (!state.activatedAt || state.baselineIds.some(id => typeof id !== 'string' || !id) || new Set(state.baselineIds).size !== state.baselineIds.length) {
      throw new Error('COMMISSIONING_BASELINE_INVALID');
    }
    persist();
  }
  const baseline = new Set(state.baselineIds);
  const observeHistory = records => {
    if (!Array.isArray(records)) throw new Error('COMMISSIONING_HISTORY_INVALID');
    const ids=new Set(),decisions=new Set();
    for(const record of records){
      if(ids.has(record.id))throw new Error('COMMISSIONING_DUPLICATE_RECORD');
      ids.add(record.id);
      if(!baseline.has(record.id)&&record.decisionId){
        if(decisions.has(record.decisionId))throw new Error('COMMISSIONING_DUPLICATE_DECISION');
        decisions.add(record.decisionId);
      }
    }
    let changed = false;
    for (const record of records) {
      if (baseline.has(record.id) || !String(record.metadata?.context?.monitorCycleId ?? '').startsWith('autonomous-paper-monitor-v1:') ||
        !['BUY', 'SELL'].includes(record.direction) || !record.clickTime ||
        !['PENDING_CONFIRMATION','PAPER_CONFIRMED'].includes(record.execution?.status)) continue;
      if (!timestamp(record.createdAt) || Date.parse(record.createdAt) < Date.parse(state.activatedAt))
        throw new Error('COMMISSIONING_TEMPORAL_IDENTITY_INVALID');
      if (record.execution?.status === 'PAPER_CONFIRMED' && record.execution.paperOnly !== true)
        throw new Error('COMMISSIONING_PAPER_PROVENANCE_INVALID');
      const projected = projectRecord(record);
      if (!projected.decisionId || !projected.monitorCycleId || !projected.asset) throw new Error('COMMISSIONING_IDENTITY_INVALID');
      if (projected.entryReferenceFound && (projected.entryReferenceLagMs < 0 || projected.entryReferenceLagMs > REFERENCE_DEADLINE_MS))
        throw new Error('COMMISSIONING_ENTRY_REFERENCE_INVALID');
      if (projected.expiryReferenceFound && (projected.expiryReferenceLagMs < 0 || projected.expiryReferenceLagMs > REFERENCE_DEADLINE_MS))
        throw new Error('COMMISSIONING_EXPIRY_REFERENCE_INVALID');
      if (projected.settlementFinalState === 'SETTLED' && !projected.expiryReferenceFound)
        throw new Error('COMMISSIONING_SETTLEMENT_REFERENCE_INVALID');
      if (JSON.stringify(state.entries[record.id]) !== JSON.stringify(projected)) { state.entries[record.id] = projected; changed = true; }
    }
    if (changed) persist();
    return changed;
  };
  const observeCycle = (cycleId, summary) => {
    if (!/^autonomous-paper-monitor-v1:\d+$/.test(cycleId) || !summary || typeof summary !== 'object') throw new Error('COMMISSIONING_CYCLE_INVALID');
    const safeReasons=value=>Object.fromEntries(Object.entries(value??{}).filter(([key, n]) => REASON_SET.has(key) && Number.isSafeInteger(n) && n >= 0));
    const reasons = safeReasons(summary.reasons);
    const projected = { zeroRecord: summary.zeroRecord === true, recordCount: Number.isSafeInteger(summary.recordCount) ? summary.recordCount : 0,
      skippedCount: Number.isSafeInteger(summary.skippedCount) ? summary.skippedCount : 0, reasons,
      skippedReasons:safeReasons(summary.skippedReasons),unavailableReasons:safeReasons(summary.unavailableReasons) };
    if(state.cycles[cycleId]&&JSON.stringify(state.cycles[cycleId])!==JSON.stringify(projected))throw new Error('COMMISSIONING_DUPLICATE_CYCLE_CONFLICT');
    state.cycles[cycleId] = projected;
    persist();
  };
  const snapshot = () => structuredClone(state);
  return Object.freeze({ observeHistory, observeCycle, snapshot });
}

export function buildCommissioningStatus({ ledger, monitor = null, providers = {}, evidence = null, settlement = null } = {}) {
  if (!ledger) return { ok: false, mode: 'PAPER_ONLY', automatedBrokerExecution: false, state: 'UNAVAILABLE' };
  const safeProvider=value=>({enabled:value?.enabled===true,running:value?.running===true,
    ready:value?.ready===true,connected:value?.connected===true});
  const providerStatus={twelveWebSocket:safeProvider(providers.twelveWebSocket),biquote:safeProvider(providers.biquote),
    coinbase:Object.fromEntries(Object.entries(providers.coinbase??{}).filter(([asset])=>safeAsset(asset))
      .map(([asset,value])=>[asset,safeProvider(value)]))};
  const state = ledger.snapshot(), entries = Object.values(state.entries),
    summaries = monitor?.cycleSummaries ?? state.cycles, cycles = Object.values(summaries);
  const planned = entries.length, entryFound = entries.filter(e => e.entryReferenceFound).length;
  const expiryEligible = entries.filter(e => e.entryReferenceFound && e.settlementFinalState !== 'PENDING');
  const expiryFound = expiryEligible.filter(e => e.expiryReferenceFound).length;
  const entryLags = entries.map(e => e.entryReferenceLagMs).filter(Number.isFinite);
  const expiryLags = entries.map(e => e.expiryReferenceLagMs).filter(Number.isFinite);
  const byReason = count(entries.filter(e => e.settlementFinalState === 'DATA_INVALID'), e => e.settlementMissReason ?? 'OTHER_SANITIZED_REASON');
  const zero = cycles.filter(c => c.zeroRecord);
  const completed = Object.keys(summaries).sort((a,b)=>Number(a.split(':').at(-1))-Number(b.split(':').at(-1))).at(-1) ?? null;
  const lastFailure = monitor?.last && !['COMPLETED', 'IDEMPOTENT'].includes(monitor.last.status)
    ? classifyCycleReason(monitor.last.reason ?? monitor.last.status) : null;
  return {
    ok: true, schemaVersion: COMMISSIONING_VERSION, mode: 'PAPER_ONLY', automatedBrokerExecution: false,
    state: monitor?.enabled===true?'OBSERVING':'INACTIVE', providerStatus,
    temporalEntryCoverage: { planned, found: entryFound, missed: entries.filter(e => e.entryReferenceMissReason).length,
      pending: entries.filter(e => !e.entryReferenceFound && !e.entryReferenceMissReason).length },
    temporalExpiryCoverage: { eligible: expiryEligible.length, found: expiryFound,
      missed: entries.filter(e => e.settlementMissReason === 'PAPER_EXIT_REFERENCE_WINDOW_MISSED').length },
    entryReferenceLagMs: { median: percentile(entryLags, 0.5), p95: percentile(entryLags, 0.95), max: entryLags.length ? Math.max(...entryLags) : null },
    expiryReferenceLagMs: { median: percentile(expiryLags, 0.5), p95: percentile(expiryLags, 0.95), max: expiryLags.length ? Math.max(...expiryLags) : null },
    referenceWindowMisses: count(entries, e => e.settlementMissReason?.includes('REFERENCE_WINDOW_MISSED') ? e.settlementMissReason : null),
    zeroRecordCyclesByReason: Object.fromEntries(CYCLE_REASONS.map(reason => [reason, zero.reduce((sum, cycle) => sum + (cycle.reasons[reason]?1:0), 0)])),
    skippedRecordsByReason: Object.fromEntries(CYCLE_REASONS.map(reason => [reason, cycles.reduce((sum, cycle) => sum + (cycle.skippedReasons?.[reason] ?? 0), 0)])),
    dataInvalidByReason: byReason, cyclesObserved: cycles.length, zeroRecordCycles: zero.length,
    providerErrors: cycles.reduce((sum,c)=>sum+(c.unavailableReasons?.PROVIDER_UNAVAILABLE??0),0),
    rateLimitCooldowns: cycles.reduce((sum,c)=>sum+(c.unavailableReasons?.PROVIDER_COOLDOWN??0),0),
    skippedRecords: cycles.reduce((sum, c) => sum + c.skippedCount, 0),
    monitorState: monitor?.last?.status ?? 'UNKNOWN', settlementPending: entries.filter(e=>e.settlementFinalState==='PENDING').length,
    evidenceRuntimeHealth: evidence ? { paused: evidence.paused === true, collectionClosed: evidence.collectionClosed === true } : null,
    lastSuccessfulCompleteCycle: completed, lastFailureReason: lastFailure
  };
}
