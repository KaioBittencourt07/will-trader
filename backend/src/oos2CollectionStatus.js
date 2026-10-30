import { CONTRACT, readFreeze } from './evaluateOos2.js';

const defaultFreeze = new URL('../config/experiments/edge-gate-oos2-freeze.json', import.meta.url);
const cycleId = r => r?.metadata?.context?.monitorCycleId;
// Membership only: never aggregate or report the settlement labels.
const official = r => typeof cycleId(r) === 'string' && /^autonomous-paper-monitor-v1:.+/.test(cycleId(r)) &&
  r.execution?.status === 'PAPER_CONFIRMED' && r.outcomeMetadata?.settlementVersion === 'paper-outcome-settlement-v2' &&
  r.outcomeMetadata?.source === 'paper-live-temporal-reference-v1' && ['WIN', 'LOSS', 'TIE'].includes(r.outcome);
const time = r => typeof r.settledAt === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(r.settledAt) ? Date.parse(r.settledAt) : NaN;

// Checkpoint counts are capped at the first 50, before any integrity filtering.
// Completeness is independent external evidence, never inferred from settlements.
// No evaluator invocation, performance calculation, logging, or history writes.
export function oos2CollectionStatus(history, { completedCycleIds = [], freezePath = defaultFreeze } = {}) {
  if (!Array.isArray(history)) throw new Error('INVALID_COLLECTION_HISTORY');
  if (!Array.isArray(completedCycleIds) || completedCycleIds.some(id => typeof id !== 'string')) throw new Error('INVALID_COMPLETENESS_EVIDENCE');
  let freezeIntegrity = 'PASS';
  try { readFreeze(freezePath); } catch { freezeIntegrity = 'FAIL'; }
  const cut = Date.parse(CONTRACT.edgeCut), groups = new Map();
  let preCutOfficialObserved = 0;
  for (const r of history) {
    if (!official(r)) continue;
    const id = cycleId(r), timestamp = time(r);
    if (!groups.has(id)) groups.set(id, { firstPost: Infinity, pre: false, post: [], badTime: false });
    const g = groups.get(id);
    if (!Number.isFinite(timestamp)) g.badTime = true;
    else if (timestamp <= cut) { g.pre = true; preCutOfficialObserved++; }
    else { g.firstPost = Math.min(g.firstPost, timestamp); g.post.push(r); }
  }
  const selected = [...groups].filter(([,g]) => g.post.length).sort((a,b) =>
    a[1].firstPost-b[1].firstPost || (a[0]<b[0] ? -1 : a[0]>b[0] ? 1 : 0)).slice(0,50);
  const complete = new Set(completedCycleIds);
  const completedCandidateCycles = selected.filter(([id]) => complete.has(id)).length;
  const unorderableCycles = [...groups.values()].filter(g => !g.post.length && g.badTime).length;
  let invalidCycles = 0, crossCutCycles = 0;
  for (const [,g] of selected) {
    if (g.pre) crossCutCycles++;
    const values = g.post.map(r => r.metadata?.featureSnapshot?.momentum);
    const malformed = values.some(v => typeof v !== 'number' || !Number.isFinite(v));
    // Match finite aggregate integrity without applying or comparing the edge gate.
    const overflow = !malformed && !Number.isFinite(values.reduce((sum,v) => sum+Math.abs(v)/values.length,0));
    if (g.pre || g.badTime || malformed || overflow) invalidCycles++;
  }
  const historyContinuity = preCutOfficialObserved === CONTRACT.officialPreCutN ? 'PASS' : 'FAIL';
  // Invalid/cross-cut candidates stay in the checkpoint, as specified by the plan.
  const formalAnalysisAllowed = freezeIntegrity === 'PASS' && historyContinuity === 'PASS' &&
    selected.length === 50 && completedCandidateCycles === 50 && unorderableCycles === 0;
  return {
    experiment: 'WILL Edge Gate OOS-2', status: formalAnalysisAllowed ? 'READY_FOR_FORMAL_ANALYSIS' : 'COLLECTING',
    edgeCut: CONTRACT.edgeCut, thresholdLocked: true, operatorLocked: true,
    candidateCyclesObserved: selected.length, requiredCandidateCycles: 50, completedCandidateCycles,
    incompleteCandidateCycles: selected.length-completedCandidateCycles,
    invalidCycles, crossCutCycles, unorderableCycles,
    preCutOfficialExpected: CONTRACT.officialPreCutN, preCutOfficialObserved, historyContinuity, freezeIntegrity,
    progressPercent: selected.length/50*100, formalAnalysisAllowed
  };
}
