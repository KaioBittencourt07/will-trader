import { readFileSync } from 'node:fs';
import path from 'node:path';

export function readOos2CollectionEvidence({ stateFile = process.env.WILL_PAPER_MONITOR_STATE_FILE ||
  path.join(process.cwd(), 'data', 'will-paper-monitor-state.json') } = {}) {
  try {
    const state = JSON.parse(readFileSync(stateFile, 'utf8').replace(/^\uFEFF/, ''));
    if (state?.monitorVersion !== 'autonomous-paper-monitor-v1' || !Array.isArray(state.completedCycleIds) ||
      state.completedCycleIds.some(id => typeof id !== 'string' || !/^autonomous-paper-monitor-v1:.+/.test(id))) {
      return { completedCycleIds: [], completenessEvidence: 'UNAVAILABLE' };
    }
    // Durable monitor completion proves scheduler termination,
    // not completeness of the set of records created for the cycle.
    // Never promote IDs, even if unknown future fields claim an inventory.
    return { completedCycleIds: [], completenessEvidence: 'DEGRADED' };
  } catch {
    return { completedCycleIds: [], completenessEvidence: 'UNAVAILABLE' };
  }
}
