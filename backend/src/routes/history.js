import { Router } from 'express';
import { summarize } from '../../../learning/src/statistics.js';
import { buildConfidenceCalibration, buildLearningReadiness } from '../../../learning/src/calibration.js';
import { resolveProspectiveOutcome } from '../../../learning/src/outcomeResolver.js';
import { getLocalRelaySnapshot, getLocalRelayStatus, getMarketDataEngine } from './market.js';

const router = Router();

function storeFor(req) {
  const store = req.app.locals.historyStore;
  if (!store) throw new Error('Histórico não inicializado.');
  return store;
}

function learningSnapshot(store) {
  const records = store.list();
  const minimumSamples = Number(process.env.WILL_CALIBRATION_MINIMUM_SAMPLES || 30);
  return {
    metrics: summarize(records),
    calibration: buildConfidenceCalibration(records, { minimumSamples }),
    readiness: buildLearningReadiness(records, { minimumSamples })
  };
}

router.get('/history', (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 1_000);
    const records = storeFor(req).list();
    return res.json({ ok: true, total: records.length, records: records.slice(-limit).reverse() });
  } catch (error) {
    return res.status(503).json({ ok: false, error: error.message });
  }
});

router.post('/history/:id/outcome', (req, res) => {
  try {
    const { outcome, exitPrice = null, ...metadata } = req.body ?? {};
    const current = storeFor(req).list().find((item) => item.id === req.params.id);
    if (!current) throw new Error('Sinal não encontrado.');
    if (current.execution?.status !== 'CONFIRMED') {
      throw new Error('Confirme a entrada realmente executada antes de registrar WIN ou LOSS.');
    }
    const record = storeFor(req).settle(req.params.id, outcome, { ...metadata, exitPrice, recordedBy: 'operator' });
    return res.json({ ok: true, record, learning: learningSnapshot(storeFor(req)) });
  } catch (error) {
    return res.status(error.message === 'Sinal não encontrado.' ? 404 : 400).json({ ok: false, error: error.message });
  }
});

router.post('/history/:id/executed', (req, res) => {
  try {
    const record = storeFor(req).confirmExecution(req.params.id, req.body ?? {});
    return res.json({ ok: true, record });
  } catch (error) {
    return res.status(error.message === 'Sinal não encontrado.' ? 404 : 400).json({ ok: false, error: error.message });
  }
});

router.post('/history/resolve', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.body?.limit || 1), 1), 3);
    const open = storeFor(req).list().filter((record) => record.status === 'OPEN').slice(0, limit);
    const resolved = [];
    const pending = [];
    for (const record of open) {
      const resolverStartedAt = Date.now();
      const snapshot = await getLocalRelaySnapshot(record.asset, record.timeframe || '1min', 50);
      const outcome = resolveProspectiveOutcome(record, { price: snapshot.price, timestamp: snapshot.timestamp });
      if (!outcome.resolved) {
        pending.push({ id: record.id, reason: outcome.reason, dueAt: outcome.dueAt });
        continue;
      }
      resolved.push(storeFor(req).settle(record.id, outcome.outcome, {
        exitPrice: outcome.exitPrice,
        source: 'market-relay-prospective-paper',
        referenceTimestamp: outcome.referenceTimestamp,
        dueAt: outcome.dueAt,
        resolverLatencyMs: Date.now() - resolverStartedAt
      }));
    }
    return res.json({ ok: true, resolved, pending });
  } catch (error) {
    return res.status(503).json({ ok: false, error: error.message });
  }
});

router.get('/metrics', (req, res) => {
  try {
    const records = storeFor(req).list();
    const withHour = records.map((record) => ({
      ...record,
      hour: record.signalTimestamp ? new Date(record.signalTimestamp).getUTCHours() : 'UNKNOWN'
    }));
    const minimumSamples = Number(process.env.WILL_CALIBRATION_MINIMUM_SAMPLES || 30);
    return res.json({
      ok: true,
      metrics: summarize(withHour),
      operational: {
        provider: getMarketDataEngine().getMetrics(),
        relay: getLocalRelayStatus()
      },
      calibration: buildConfidenceCalibration(records, { minimumSamples }),
      learning: buildLearningReadiness(records, { minimumSamples })
    });
  } catch (error) {
    return res.status(503).json({ ok: false, error: error.message });
  }
});

export default router;
