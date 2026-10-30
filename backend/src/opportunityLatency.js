export const OPPORTUNITY_LATENCY_VERSION = 'opportunity-latency-v1';

/** Additive, numeric-only telemetry for the opportunity hot path. */
export function createOpportunityLatency({ now = () => performance.now() } = {}) {
  const startedAt = now();
  const stages = new Map();
  const duration = (started) => Math.max(0, now() - started);
  const record = (name, value) => stages.set(name, (stages.get(name) ?? 0) + Math.max(0, Number(value) || 0));

  function stage(name, work) {
    const stageStartedAt = now();
    try {
      const value = work();
      if (value && typeof value.then === 'function') {
        return value.then(
          (result) => { record(name, duration(stageStartedAt)); return result; },
          (error) => { record(name, duration(stageStartedAt)); throw error; }
        );
      }
      record(name, duration(stageStartedAt));
      return value;
    } catch (error) {
      record(name, duration(stageStartedAt));
      throw error;
    }
  }

  function snapshot() {
    return Object.freeze({
      version: OPPORTUNITY_LATENCY_VERSION,
      totalMs: duration(startedAt),
      stages: Object.freeze({
        universeSelectionMs: stages.get('universeSelectionMs') ?? 0,
        marketFetchMs: stages.get('marketFetchMs') ?? 0,
        marketContextMs: stages.get('marketContextMs') ?? 0,
        decisionPipelineMs: stages.get('decisionPipelineMs') ?? 0,
        persistenceMs: stages.get('persistenceMs') ?? 0,
        scannerMs: stages.get('scannerMs') ?? 0,
        rankingMs: stages.get('rankingMs') ?? 0,
        responsePreparationMs: stages.get('responsePreparationMs') ?? 0,
        aiAuditorMs: 0
      }),
      aiAuditor: Object.freeze({ applied: false, reason: 'NOT_IN_OPPORTUNITY_HOT_PATH' })
    });
  }

  return Object.freeze({ stage, record, snapshot });
}
