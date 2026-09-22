import { expiryAt, prospectiveOutcomeDue, resolveProspectiveOutcome } from '../../learning/src/outcomeResolver.js';

export const PAPER_OUTCOME_SETTLEMENT_VERSION = 'paper-outcome-settlement-v2';
export const PAPER_OUTCOME_REFERENCE_MAX_LAG_MS = 30_000;
const CAMPAIGN_PREFIX = 'autonomous-paper-monitor-v1:';

function settlementScope(scope) {
  if (scope == null) return null;
  if (typeof scope?.protocolId !== 'string' || !scope.protocolId || typeof scope?.campaignId !== 'string' || !scope.campaignId) {
    throw new Error('PAPER_OUTCOME_SETTLEMENT_SCOPE_INCOMPLETE');
  }
  return Object.freeze({ protocolId: scope.protocolId, campaignId: scope.campaignId });
}

function isCampaignRecord(record, scope) {
  if (scope) return record?.protocolId === scope.protocolId && record?.campaignId === scope.campaignId;
  return String(record?.metadata?.context?.monitorCycleId || '').startsWith(CAMPAIGN_PREFIX);
}

function eligibleOpenRecord(record, scope) {
  return isCampaignRecord(record, scope)
    && record?.status === 'OPEN'
    && ['BUY', 'SELL'].includes(record?.direction)
    && record?.execution?.status !== 'CONFIRMED'
    && !record?.outcome;
}

function referenceFor(record, targetTimestamp, { coinbaseTemporalFeeds, biquoteForexFeed } = {}) {
  const asset = String(record?.asset || '').trim().toUpperCase();
  const coinbaseFeed = coinbaseTemporalFeeds instanceof Map ? coinbaseTemporalFeeds.get(asset) : null;
  const coinbaseReference = coinbaseFeed?.referenceAtOrAfter?.(targetTimestamp, PAPER_OUTCOME_REFERENCE_MAX_LAG_MS) ?? null;
  if (coinbaseReference) return coinbaseReference;
  return biquoteForexFeed?.referenceAtOrAfter?.(asset, targetTimestamp, PAPER_OUTCOME_REFERENCE_MAX_LAG_MS) ?? null;
}

function invalidSettlement(paperMutationPort, record, reason, metadata = {}) {
  return paperMutationPort.settlePaperOutcome(record.id, 'DATA_INVALID', {
    settlementVersion: PAPER_OUTCOME_SETTLEMENT_VERSION,
    reason,
    source: 'PAPER_AUTOMATIC_SETTLEMENT',
    paperOnly: true,
    automatedBrokerExecution: false,
    ...metadata
  });
}

export function settleDuePaperCampaignOutcomes({
  historyStore,
  paperMutationPort,
  coinbaseTemporalFeeds,
  biquoteForexFeed,
  scope = null,
  recordAdmission = () => true,
  now = Date.now(),
  maxReferenceLagMs = PAPER_OUTCOME_REFERENCE_MAX_LAG_MS
} = {}) {
  if (!historyStore
    || typeof historyStore.list !== 'function'
    || !paperMutationPort
    || typeof paperMutationPort.settlePaperOutcome !== 'function'
    || typeof paperMutationPort.confirmPaperExecution !== 'function') {
    throw new Error('PAPER_OUTCOME_HISTORY_STORE_REQUIRED');
  }
  if (Number(maxReferenceLagMs) !== PAPER_OUTCOME_REFERENCE_MAX_LAG_MS) {
    throw new Error('PAPER_OUTCOME_REFERENCE_WINDOW_FROZEN');
  }

  const checkedAt = Number(now);
  if (!Number.isFinite(checkedAt)) throw new Error('PAPER_OUTCOME_CLOCK_INVALID');
  const exactScope = settlementScope(scope);

  if(typeof recordAdmission!=='function')throw new Error('PAPER_RECORD_ADMISSION_REQUIRED');
  const records = historyStore.list().filter(record => eligibleOpenRecord(record, exactScope)&&recordAdmission(record));
  const results = [];
  let entriesCaptured = 0;
  let settled = 0;
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let dataInvalid = 0;
  let pending = 0;

  for (const originalRecord of records) {
    let record = originalRecord;

    // PAPER entry must be observed prospectively at/after the planned click.
    // The signal-time price is never reused as a future PAPER entry price.
    if (record.execution?.status !== 'PAPER_CONFIRMED') {
      const plannedMs = Date.parse(record.execution?.plannedClickTime ?? record.clickTime ?? '');
      if (!Number.isFinite(plannedMs)) {
        const value = invalidSettlement(paperMutationPort, record, 'PAPER_ENTRY_TIME_INVALID');
        settled += 1;
        dataInvalid += 1;
        results.push({ id: record.id, asset: record.asset, outcome: value.outcome, reason: 'PAPER_ENTRY_TIME_INVALID' });
        continue;
      }

      if (checkedAt < plannedMs) {
        pending += 1;
        results.push({ id: record.id, asset: record.asset, outcome: null, reason: 'PAPER_ENTRY_NOT_DUE', entryDueAt: new Date(plannedMs).toISOString() });
        continue;
      }

      const entryReference = referenceFor(record, plannedMs, { coinbaseTemporalFeeds, biquoteForexFeed });
      if (!entryReference) {
        if (checkedAt <= plannedMs + PAPER_OUTCOME_REFERENCE_MAX_LAG_MS) {
          pending += 1;
          results.push({ id: record.id, asset: record.asset, outcome: null, reason: 'WAITING_BOUNDED_ENTRY_REFERENCE', entryDueAt: new Date(plannedMs).toISOString() });
          continue;
        }

        const value = invalidSettlement(paperMutationPort, record, 'PAPER_ENTRY_REFERENCE_WINDOW_MISSED', {
          entryDueAt: new Date(plannedMs).toISOString(),
          maximumReferenceLagMs: PAPER_OUTCOME_REFERENCE_MAX_LAG_MS
        });
        settled += 1;
        dataInvalid += 1;
        results.push({ id: record.id, asset: record.asset, outcome: value.outcome, reason: 'PAPER_ENTRY_REFERENCE_WINDOW_MISSED' });
        continue;
      }

      record = paperMutationPort.confirmPaperExecution(record.id, {
        referenceTimestamp: entryReference.timestamp,
        referencePrice: entryReference.price,
        source: entryReference.provider ?? 'PAPER_TEMPORAL_ENTRY_REFERENCE'
      });
      entriesCaptured += 1;
    }

    const due = prospectiveOutcomeDue(record, checkedAt);
    const dueMs = expiryAt(record);
    if (!Number.isFinite(dueMs)) {
      const value = invalidSettlement(paperMutationPort, record, 'EXPIRY_NOT_RESOLVABLE');
      settled += 1;
      dataInvalid += 1;
      results.push({ id: record.id, asset: record.asset, outcome: value.outcome, reason: 'EXPIRY_NOT_RESOLVABLE' });
      continue;
    }

    if (!due.allowed) {
      pending += 1;
      results.push({ id: record.id, asset: record.asset, outcome: null, reason: 'EXPIRY_NOT_REACHED', dueAt: due.dueAt });
      continue;
    }

    const exitReference = referenceFor(record, dueMs, { coinbaseTemporalFeeds, biquoteForexFeed });
    if (!exitReference) {
      if (checkedAt <= dueMs + PAPER_OUTCOME_REFERENCE_MAX_LAG_MS) {
        pending += 1;
        results.push({ id: record.id, asset: record.asset, outcome: null, reason: 'WAITING_BOUNDED_EXIT_REFERENCE', dueAt: due.dueAt });
        continue;
      }

      const value = invalidSettlement(paperMutationPort, record, 'PAPER_EXIT_REFERENCE_WINDOW_MISSED', {
        dueAt: due.dueAt,
        maximumReferenceLagMs: PAPER_OUTCOME_REFERENCE_MAX_LAG_MS
      });
      settled += 1;
      dataInvalid += 1;
      results.push({ id: record.id, asset: record.asset, outcome: value.outcome, reason: 'PAPER_EXIT_REFERENCE_WINDOW_MISSED', dueAt: due.dueAt });
      continue;
    }

    const resolution = resolveProspectiveOutcome(record, {
      price: exitReference.price,
      timestamp: exitReference.timestamp,
      valid: exitReference.valid !== false,
      status: exitReference.status ?? 'OK'
    }, checkedAt);

    if (!resolution.resolved) {
      pending += 1;
      results.push({ id: record.id, asset: record.asset, outcome: null, reason: resolution.reason, dueAt: resolution.dueAt });
      continue;
    }

    const value = paperMutationPort.settlePaperOutcome(record.id, resolution.outcome, {
      settlementVersion: PAPER_OUTCOME_SETTLEMENT_VERSION,
      source: 'paper-live-temporal-reference-v1',
      referenceProvider: exitReference.provider ?? null,
      referenceTimestamp: resolution.referenceTimestamp ?? exitReference.timestamp ?? null,
      dueAt: resolution.dueAt ?? due.dueAt,
      entryPrice: resolution.entryPrice ?? record.execution?.actualEntryPrice ?? null,
      exitPrice: resolution.exitPrice ?? null,
      referenceLagMs: Number.isFinite(Number(exitReference.lagMs)) ? Number(exitReference.lagMs) : null,
      paperOnly: true,
      automatedBrokerExecution: false
    });

    settled += 1;
    if (value.outcome === 'WIN') wins += 1;
    else if (value.outcome === 'LOSS') losses += 1;
    else if (value.outcome === 'TIE') ties += 1;
    else if (value.outcome === 'DATA_INVALID') dataInvalid += 1;
    results.push({
      id: record.id,
      asset: record.asset,
      direction: record.direction,
      outcome: value.outcome,
      entryPrice: resolution.entryPrice ?? null,
      exitPrice: resolution.exitPrice ?? null,
      referenceTimestamp: resolution.referenceTimestamp ?? null,
      referenceLagMs: Number.isFinite(Number(exitReference.lagMs)) ? Number(exitReference.lagMs) : null
    });
  }

  return Object.freeze({
    version: PAPER_OUTCOME_SETTLEMENT_VERSION,
    mode: 'PAPER_ONLY',
    settlementScope: exactScope ? Object.freeze({ mode: 'EXACT_PROTOCOL_CAMPAIGN', ...exactScope }) : Object.freeze({ mode: 'LEGACY_MONITOR_PREFIX', campaignPrefix: CAMPAIGN_PREFIX }),
    checkedAt: new Date(checkedAt).toISOString(),
    openCampaignSignalsChecked: records.length,
    entriesCaptured,
    settled,
    pending,
    wins,
    losses,
    ties,
    dataInvalid,
    maximumReferenceLagMs: PAPER_OUTCOME_REFERENCE_MAX_LAG_MS,
    automatedBrokerExecution: false,
    results: Object.freeze(results.map((item) => Object.freeze({ ...item })))
  });
}
