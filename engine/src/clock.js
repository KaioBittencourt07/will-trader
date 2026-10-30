export function createExecutionClock({ now = () => Date.now() } = {}) {
  return {
    now,
    nowIso() { return new Date(now()).toISOString(); },
    ageMs(timestamp) { const value = Date.parse(timestamp); return Number.isFinite(value) ? now() - value : null; }
  };
}
