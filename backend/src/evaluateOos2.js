import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const CONTRACT = Object.freeze({ schemaVersion: 'edge-gate-oos2-freeze-v1', policy: 'IMMUTABLE_AFTER_FREEZE',
  edgeCut: '2026-09-15T02:09:11.360Z', frozenThreshold: 0.599936, officialPreCutN: 217 });
export function validateFreeze(value) {
  if (!value || Object.entries(CONTRACT).some(([key, expected]) => value[key] !== expected)) throw new Error('INVALID_OOS2_FREEZE');
  return value;
}
export const EXPECTED_FREEZE_SHA256 = '1F0D03A1FFD2AB1ADC0397BDAFFCCBB30D1B3BC0ACBC5C87B7779B3E920B3564';
export function readFreeze(path) {
  const bytes = readFileSync(path);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash.toUpperCase() !== EXPECTED_FREEZE_SHA256.toUpperCase()) throw new Error('INVALID_OOS2_FREEZE_SHA256');
  return validateFreeze(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')));
}
const cycleId = r => r?.metadata?.context?.monitorCycleId;
const official = r => typeof cycleId(r) === 'string' && /^autonomous-paper-monitor-v1:.+/.test(cycleId(r)) &&
  r.execution?.status === 'PAPER_CONFIRMED' && r.outcomeMetadata?.settlementVersion === 'paper-outcome-settlement-v2' &&
  r.outcomeMetadata?.source === 'paper-live-temporal-reference-v1' && ['WIN', 'LOSS', 'TIE'].includes(r.outcome);
const time = r => typeof r.settledAt === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(r.settledAt) ? Date.parse(r.settledAt) : NaN;
export function clusterBootstrap(records) {
  const seed = 20260915, replications = 10000, groups = new Map();
  for (const r of records) {
    const id = cycleId(r);
    if (typeof id !== 'string' || !['WIN', 'LOSS', 'TIE'].includes(r.outcome)) throw new Error('INVALID_BOOTSTRAP_CLUSTER');
    if (!groups.has(id)) groups.set(id, { WIN: 0, LOSS: 0, TIE: 0 });
    groups.get(id)[r.outcome]++;
  }
  // Sufficient statistics carry every outcome in a selected cycle, including ties.
  const clusters = [...groups.keys()].sort().map(id => groups.get(id));
  let state = seed >>> 0;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  const rates = []; let zeroBinaryReplications = 0;
  if (clusters.length) for (let b = 0; b < replications; b++) {
    let w = 0, l = 0;
    for (let j = 0; j < clusters.length; j++) { const c = clusters[Math.floor(random()*clusters.length)]; w += c.WIN; l += c.LOSS; }
    if (w+l) rates.push(w/(w+l)); else zeroBinaryReplications++;
  }
  rates.sort((a,b) => a-b);
  const percentile = p => { const index = (rates.length-1)*p, low = Math.floor(index); return rates[low]+(rates[Math.ceil(index)]-rates[low])*(index-low); };
  return { method: 'cluster bootstrap percentile 95%', resamplingUnit: 'monitorCycleId', replacement: true,
    seed, rng: 'xorshift32', requestedReplications: replications, attemptedReplications: clusters.length ? replications : 0,
    validReplications: rates.length, zeroBinaryReplications, clusterCount: clusters.length,
    interval95: rates.length ? [percentile(.025), percentile(.975)] : null,
    percentileMethod: 'linear interpolation at (B_valid-1)*p',
    limitation: 'Zero-binary resamples excluded and counted; assumes independent cycles; not a guarantee of financial edge.' };
}
function stats(records) {
  const wins = records.filter(r => r.outcome === 'WIN').length, losses = records.filter(r => r.outcome === 'LOSS').length;
  const n = wins + losses; let streak = 0, maxLosingStreak = 0;
  const ordered = records.map((r, index) => ({ r, index })).sort((a,b) => {
    const chronological = time(a.r)-time(b.r); if (chronological) return chronological;
    const aid = a.r.id == null ? null : String(a.r.id), bid = b.r.id == null ? null : String(b.r.id);
    if (aid !== null && bid !== null) return (aid < bid ? -1 : aid > bid ? 1 : 0) || a.index-b.index;
    if (aid !== null || bid !== null) return aid !== null ? -1 : 1;
    return a.index-b.index;
  });
  for (const { r } of ordered) { streak = r.outcome === 'LOSS' ? streak + 1 : 0; maxLosingStreak = Math.max(maxLosingStreak, streak); }
  let confidenceInterval95 = null;
  if (n) { const p = wins/n, z = 1.959963984540054, d = 1+z*z/n, center = (p+z*z/(2*n))/d;
    const half = z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d; confidenceInterval95 = [center-half, center+half]; }
  return { N: records.length, WIN: wins, LOSS: losses, TIE: records.length-n, binaryN: n, binaryWinRate: n ? wins/n : null,
    naiveWilsonInterval95: confidenceInterval95, naiveWilsonMethod: 'naive/descriptive Wilson record-level; ignores within-cycle correlation',
    maxLosingStreak, expectancy: 'NOT_AVAILABLE', financialEdge: 'NOT_AVAILABLE' };
}
export function evaluateOos2(records, freeze, { completedCycleIds = [] } = {}) {
  validateFreeze(freeze); if (!Array.isArray(records)) throw new Error('INVALID_HISTORY');
  if (!Array.isArray(completedCycleIds) || completedCycleIds.some(id => typeof id !== 'string')) throw new Error('INVALID_COMPLETENESS_EVIDENCE');
  const cut = Date.parse(freeze.edgeCut), groups = new Map();
  for (const r of records.filter(official)) { const id = cycleId(r); if (!groups.has(id)) groups.set(id, []); groups.get(id).push(r); }
  const firstPost = rows => Math.min(...rows.filter(r => time(r)>cut).map(time));
  const candidates = [...groups].filter(([,rows]) => rows.some(r => time(r)>cut)).sort((a,b) =>
    firstPost(a[1])-firstPost(b[1]) || (a[0]<b[0] ? -1 : a[0]>b[0] ? 1 : 0));
  const selected = candidates.slice(0, 50);
  const unorderableCycleIds = [...groups].filter(([,rows]) => !rows.some(r => time(r)>cut) && rows.some(r => !Number.isFinite(time(r)))).map(([id]) => id).sort();
  const complete = new Set(completedCycleIds);
  const preCutOfficialRecordsObserved = [...groups.values()].reduce((count, rows) =>
    count + rows.filter(r => Number.isFinite(time(r)) && time(r)<=cut).length, 0);
  const historyContinuity = { expectedPreCutOfficialRecords: freeze.officialPreCutN,
    observedPreCutOfficialRecords: preCutOfficialRecordsObserved,
    matchesFreeze: preCutOfficialRecordsObserved === freeze.officialPreCutN };
  const checkpointReached = historyContinuity.matchesFreeze && selected.length === 50 && selected.every(([id]) => complete.has(id)) && !unorderableCycleIds.length;
  const cycles = [], accepted = []; let eligibleRecords = 0;
  for (const [monitorCycleId, rows] of selected) {
    const post = rows.filter(r => time(r)>cut); if (!post.length && rows.every(r => Number.isFinite(time(r)))) continue;
    eligibleRecords += post.length;
    const reasons = [];
    if (rows.some(r => !Number.isFinite(time(r)))) reasons.push('INVALID_SETTLED_AT');
    if (post.length && rows.some(r => time(r)<=cut)) reasons.push('CROSS_CUT_CYCLE');
    const values = post.map(r => r.metadata?.featureSnapshot?.momentum);
    if (values.some(v => typeof v !== 'number' || !Number.isFinite(v))) reasons.push('INVALID_MOMENTUM');
    const mean = !reasons.length && values.length ? values.reduce((sum,v) => sum + Math.abs(v)/values.length, 0) : null;
    if (mean !== null && !Number.isFinite(mean)) reasons.push('INVALID_MEAN');
    const status = reasons.length || mean === null ? 'INVALID' : mean <= freeze.frozenThreshold ? 'ACCEPT' : 'REJECT';
    cycles.push({ monitorCycleId, status, reasons, eligibleRecords: post.length, MeanAbsMomentum: reasons.length ? null : mean });
    if (status === 'ACCEPT') accepted.push(...post);
  }
  // Restore original order for the final tie-breaker, independent of cycle grouping.
  const acceptedSet = new Set(accepted); accepted.splice(0, accepted.length, ...records.filter(r => acceptedSet.has(r)));
  const eligibleCycles = cycles.filter(c => c.eligibleRecords>0).length;
  const acceptedCycles = cycles.filter(c => c.status === 'ACCEPT').length;
  const validCycles = cycles.filter(c => c.status !== 'INVALID').length;
  const secondary = {};
  for (const field of ['asset', 'direction', 'regime']) {
    const buckets = new Map(); for (const r of accepted) { const key = typeof r[field] === 'string' ? r[field] : 'UNKNOWN'; if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(r); }
    secondary[field] = Object.fromEntries([...buckets].map(([key, rows]) => [key, stats(rows)]));
  }
  return { evaluatorVersion: 'edge-gate-oos2-readonly-v1', threshold: freeze.frozenThreshold, operator: '<=',
    analysisStatus: checkpointReached ? 'FORMAL_FIRST_50' : 'PRELIMINARY',
    historyContinuity,
    checkpoint: { requiredCandidateCycles: 50, observedCandidateCycles: candidates.length,
      selectedCycleIds: selected.map(([id]) => id), completenessConfirmedCycles: selected.filter(([id]) => complete.has(id)).length,
      unorderableCycleIds, laterCandidateCyclesExcluded: Math.max(0, candidates.length-50) },
    candidateCycles: selected.length, validCycles,
    coverageAllCandidates: selected.length ? acceptedCycles/selected.length : null,
    coverageValidCandidates: validCycles ? acceptedCycles/validCycles : null,
    eligibleRecords, eligibleCycles, acceptedCycles, rejectedCycles: cycles.filter(c => c.status === 'REJECT').length,
    invalidCycles: cycles.filter(c => c.status === 'INVALID').length, acceptedRecords: accepted.length,
    cycleCoverage: eligibleCycles ? acceptedCycles/eligibleCycles : null, recordCoverage: eligibleRecords ? accepted.length/eligibleRecords : null,
    ...stats(accepted), confidenceInterval95: clusterBootstrap(accepted), cycles, secondary, notes: ['Coverage includes invalid post-cut cycles in denominator.',
      'Losing streak order: settledAt, id (present IDs first), original index fallback; TIE breaks a streak.',
      'Preliminary analyses cannot inform tuning or promotion; no automatic LIVE promotion.', 'No payout/cost model supplied.'], brokerExecuted: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error('USAGE: node backend/src/evaluateOos2.js HISTORY_PATH');
    const freeze = readFreeze(new URL('../config/experiments/edge-gate-oos2-freeze.json', import.meta.url));
    const records = JSON.parse(readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
    console.log(JSON.stringify(evaluateOos2(records, freeze), null, 2));
  } catch { console.error('OOS2_EVALUATION_BLOCKED'); process.exitCode = 1; }
}
