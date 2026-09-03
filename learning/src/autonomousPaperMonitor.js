import fs from 'node:fs';
import path from 'node:path';

export const PAPER_MONITOR_VERSION = 'autonomous-paper-monitor-v1';
const MIN_INTERVAL_MS = 60_000;

function loadCompleted(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(saved?.completedCycleIds)) throw new Error('Estado durável do monitor inválido.');
  return saved.completedCycleIds.filter((id) => typeof id === 'string');
}

function persistCompleted(filePath, ids) {
  if (!filePath) throw new Error('DURABLE_STATE_REQUIRED');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ monitorVersion: PAPER_MONITOR_VERSION, completedCycleIds: [...ids] }, null, 2));
  fs.renameSync(temporary, filePath);
}

/**
 * Bounded PAPER-only scheduler. The injected runCycle may observe/analyze but
 * receives no execution capability and must return its own fail-closed result.
 */
export function createAutonomousPaperMonitor({
  enabled = false,
  intervalMs = MIN_INTERVAL_MS,
  filePath = null,
  runCycle,
  now = () => Date.now(),
  onEvent = () => {},
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
} = {}) {
  if (!Number.isFinite(Number(intervalMs)) || Number(intervalMs) < MIN_INTERVAL_MS) throw new Error(`MONITOR_INTERVAL_MIN_${MIN_INTERVAL_MS}`);
  if (typeof runCycle !== 'function') throw new Error('MONITOR_CYCLE_HANDLER_REQUIRED');
  let completed;
  try { completed = filePath ? new Set(loadCompleted(filePath)) : null; } catch (error) { completed = null; }
  let running = false;
  let timer = null;
  let last = null;

  function cycleId(at = now()) {
    if (!Number.isFinite(Number(at))) return null;
    return `${PAPER_MONITOR_VERSION}:${Math.floor(Number(at) / Number(intervalMs))}`;
  }

  function event(value) {
    last = { ...value, emittedAt: new Date(Number.isFinite(Number(now())) ? Number(now()) : Date.now()).toISOString() };
    onEvent(structuredClone(last));
    return structuredClone(last);
  }

  async function runOnce({ at = now() } = {}) {
    if (!enabled) return event({ ran: false, status: 'DISABLED', mode: 'PAPER' });
    if (!completed) return event({ ran: false, status: 'PAUSED', reason: 'DURABLE_STATE_UNAVAILABLE', mode: 'PAPER' });
    const id = cycleId(at);
    if (!id) return event({ ran: false, status: 'PAUSED', reason: 'CLOCK_FAILURE', mode: 'PAPER' });
    if (running) return event({ ran: false, status: 'OVERLAP_SKIPPED', cycleId: id, mode: 'PAPER' });
    if (completed.has(id)) return event({ ran: false, status: 'IDEMPOTENT', cycleId: id, mode: 'PAPER' });
    running = true;
    try {
      const result = await runCycle({ cycleId: id, mode: 'PAPER' });
      // A provider/data failure is a completed invalid observation for this
      // cadence slot; retrying it in a tight loop would violate provider limits.
      completed.add(id);
      persistCompleted(filePath, completed);
      return event({ ran: true, status: result?.ok === false ? 'SKIPPED_INVALID_CYCLE' : 'COMPLETED', cycleId: id, mode: 'PAPER', result: result ?? null });
    } catch (error) {
      // Do not invent a WAIT, quote, or outcome when the observation failed.
      try {
        completed.add(id);
        persistCompleted(filePath, completed);
        return event({ ran: false, status: 'SKIPPED_INVALID_CYCLE', reason: 'CYCLE_FAILURE', cycleId: id, mode: 'PAPER' });
      } catch {
        return event({ ran: false, status: 'PAUSED', reason: 'STORAGE_FAILURE', cycleId: id, mode: 'PAPER' });
      }
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer || !enabled) return health();
    timer = setIntervalFn(() => { void runOnce(); }, Number(intervalMs));
    void runOnce();
    return health();
  }

  function stop() {
    if (timer) clearIntervalFn(timer);
    timer = null;
    return health();
  }

  function health() {
    return {
      monitorVersion: PAPER_MONITOR_VERSION,
      mode: 'PAPER',
      enabled,
      intervalMs: Number(intervalMs),
      running,
      scheduled: Boolean(timer),
      durableState: completed ? 'AVAILABLE' : 'UNAVAILABLE',
      completedCycles: completed?.size ?? 0,
      last: last ? structuredClone(last) : null
    };
  }

  return { cycleId, runOnce, start, stop, health };
}

