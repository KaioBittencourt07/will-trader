/** PAPER-only cycle coordinator. Disabled by default and idempotent by cycle id. */
export function createEvidenceRunner({ enabled = false, scan, now = () => new Date().toISOString() } = {}) {
  const completed = new Set();
  let paused = null;
  async function run({ cycleId, providerHealth = 'HEALTHY', storageHealthy = true, catalogReady = true } = {}) {
    if (!enabled) return { ran: false, status: 'DISABLED', mode: 'PAPER' };
    if (!cycleId || !storageHealthy || providerHealth !== 'HEALTHY' || !catalogReady) { paused = !cycleId ? 'INVALID_CONFIG' : !storageHealthy ? 'STORAGE_FAILURE' : providerHealth !== 'HEALTHY' ? 'PROVIDER_DEGRADED' : 'AVALON_CATALOG_UNVERIFIED'; return { ran: false, status: 'PAUSED', reason: paused, mode: 'PAPER' }; }
    if (completed.has(cycleId)) return { ran: false, status: 'IDEMPOTENT', cycleId, mode: 'PAPER' };
    const startedAt = now();
    const result = await scan();
    completed.add(cycleId);
    return { ran: true, status: 'COMPLETED', mode: 'PAPER', cycleId, startedAt, telemetry: { scanned: result?.scanned ?? 0, candidates: result?.candidates?.length ?? 0, executable: result?.scanner?.funnel?.executable ?? 0, waits: Object.values(result?.scanner?.waits ?? {}).reduce((a, b) => a + b, 0) } };
  }
  return { run, health: () => ({ mode: 'PAPER', enabled, paused, completedCycles: completed.size }) };
}
