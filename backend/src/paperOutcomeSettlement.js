import { expiryAt, prospectiveOutcomeDue, resolveProspectiveOutcome } from '../../learning/src/outcomeResolver.js';

export const PAPER_OUTCOME_SETTLEMENT_VERSION = 'paper-outcome-settlement-v1';
export const PAPER_OUTCOME_REFERENCE_MAX_LAG_MS = 30_000;
const CAMPAIGN_PREFIX = 'autonomous-paper-monitor-v1:';

function isCampaignRecord(record) {
  return String(record?.metadata?.context?.monitorCycleId || '').startsWith(CAMPAIGN_PREFIX);
}

function eligibleOpenRecord(record) {
  return isCampaignRecord(record)
    && record?.status === 'OPEN'
    && ['BUY', 'SELL'].includes(record?.direction)
    && !record?.outcome;
}

function referenceFor(record, dueAt, { coinbaseTemporalFeeds, biquoteForexFeed } = {}) {
  const asset = String(record?.asset || '').trim().toUpperCase();
  const coinbaseFeed = coinbaseTemporalFeeds instanceof Map ? coinbaseTemporalFeeds.get(asset) : null;
  const coinbaseReference = coinbaseFeed?.referenceAtOrAfter?.(dueAt, PAPER_OUTCOME_REFERENCE_MAX_LAG_MS) ?? null;
  if (coinbaseReference) return coinbaseReference;
  return biquoteForexFeed?.referenceAtOrAfter?.(asset, dueAt, PAPER_OUTCOME_REFERENCE_MAX_LAG_MS) ?? null;
}

export function settleDuePaperCampaignOutcomes({
  historyStore,
  coinbaseTemporalFeeds,
  biquoteForexFeed,
  now = Date.now(),
  maxReferenceLagMs = PAPER_OUTCOME_REFERENCE_MAX_LAG_MS
} = {}) {
  if (!historyStore || typeof historyStore.list !== 'function' || typeof historyStore.settle !== 'function') {
    throw new Error('PAPER_OUTCOME_HISTORY_STORE_REQUIRED');
  }
  if (Number(maxReferenceLagMs) !== PAPER_OUTCOME_REFERENCE_MAX_LAG_MS) {
    throw new Error('PAPER_OUTCOME_REFERENCE_WINDOW_FROZEN');
  }

  const checkedAt = Number(now);
  if (!Number.isFinite(checkedAt)) throw new Error('PAPER_OUTCOME_CLOCK_INVALID');

  const records = historyStore.list().filter(eligibleOpenRecord);
  const results = [];
  let settled = 0;
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let dataInvalid = 0;
  let pending = 0;

  for (const record of records) {
    const due = prospectiveOutcomeDue(record, checkedAt);
    const dueMs = expiryAt(record);
    if (!Number.isFinite(dueMs)) {
      const value = historyStore.settle(record.id, 'DATA_INVALID', {
        settlementVersion: PAPER_OUTCOME_SETTLEMENT_VERSION,
        reason: 'EXPIRY_NOT_RESOLVABLE',
        source: 'PAPER_AUTOMATIC_SETTLEMENT',
        automatedBrokerExecution: false
      });
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

    const reference = referenceFor(record, dueMs, { coinbaseTemporalFeeds, biquoteForexFeed });
    if (!reference) {
      if (checkedAt <= dueMs + PAPER_OUTCOME_REFERENCE_MAX_LAG_MS) {
        pending += 1;
        results.push({ id: record.id, asset: record.asset, outcome: null, reason: 'WAITING_BOUNDED_REFERENCE', dueAt: due.dueAt });
        continue;
      }

      const value = historyStore.settle(record.id, 'DATA_INVALID', {
        settlementVersion: PAPER_OUTCOME_SETTLEMENT_VERSION,
        reason: 'OUTCOME_REFERENCE_WINDOW_MISSED',
        dueAt: due.dueAt,
        maximumReferenceLagMs: PAPER_OUTCOME_REFERENCE_MAX_LAG_MS,
        source: 'PAPER_AUTOMATIC_SETTLEMENT',
        automatedBrokerExecution: false
      });
      settled += 1;
      dataInvalid += 1;
      results.push({ id: record.id, asset: record.asset, outcome: value.outcome, reason: 'OUTCOME_REFERENCE_WINDOW_MISSED', dueAt: due.dueAt });
      continue;
    }

    const resolution = resolveProspectiveOutcome(record, {
      price: reference.price,
      timestamp: reference.timestamp,
      valid: reference.valid !== false,
      status: reference.status ?? 'OK'
    }, checkedAt);

    if (!resolution.resolved) {
      pending += 1;
      results.push({ id: record.id, asset: record.asset, outcome: null, reason: resolution.reason, dueAt: resolution.dueAt });
      continue;
    }

    const value = historyStore.settle(record.id, resolution.outcome, {
      settlementVersion: PAPER_OUTCOME_SETTLEMENT_VERSION,
      source: reference.provider ?? 'PAPER_TEMPORAL_REFERENCE',
      referenceTimestamp: resolution.referenceTimestamp ?? reference.timestamp ?? null,
      dueAt: resolution.dueAt ?? due.dueAt,
      entryPrice: resolution.entryPrice ?? record.entryPrice ?? null,
      exitPrice: resolution.exitPrice ?? null,
      referenceLagMs: Number.isFinite(Number(reference.lagMs)) ? Number(reference.lagMs) : null,
      automatedBrokerExecution: false,
      paperOnly: true
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
      referenceLagMs: Number.isFinite(Number(reference.lagMs)) ? Number(reference.lagMs) : null
    });
  }

  return Object.freeze({
    version: PAPER_OUTCOME_SETTLEMENT_VERSION,
    mode: 'PAPER_ONLY',
    campaignPrefix: CAMPAIGN_PREFIX,
    checkedAt: new Date(checkedAt).toISOString(),
    openCampaignSignalsChecked: records.length,
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
