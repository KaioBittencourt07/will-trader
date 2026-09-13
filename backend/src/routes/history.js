import { Router } from 'express';
import { summarize } from '../../../learning/src/statistics.js';
import { buildConfidenceCalibration, buildLearningReadiness } from '../../../learning/src/calibration.js';
import { buildLearningLab } from '../../../learning/src/learningEngine.js';
import { prospectiveOutcomeDue, resolveProspectiveOutcome } from '../../../learning/src/outcomeResolver.js';
import { getLocalRelaySnapshot, getLocalRelayStatus, getMarketDataEngine } from './market.js';

const router = Router();

function storeFor(req) {
  const store = req.app.locals.historyStore;
  if (!store) throw new Error('Histórico não inicializado.');
  return store;
}

function isValidEvidenceRecord(record = {}) {
  const quality = record.metadata?.dataQuality ?? {};
  const blockReasons = Array.isArray(record.metadata?.blockReasons) ? record.metadata.blockReasons : [];
  const technicalBlock = blockReasons.some((reason) => /^(DATA_QUALITY_|Dados atrasados\.|AUTHORITATIVE_FRESHNESS_REQUIRED|AUTHORITATIVE_FRESHNESS_MISSING|TIMESTAMP_AUTHORITY_NOT_APPROVED|AUTHORITATIVE_FRESHNESS_NOT_APPROVED|TIMESTAMP_AUTHORITY_UNVERIFIED|TIMESTAMP_AUTHORITY_DATA_INVALID|EVENT_OLDER_THAN_FROZEN_CONTRACT|MARKET_AGE_UNAVAILABLE)$/.test(String(reason)));
  const invalidStatus = new Set(['STALE', 'MARKET_CLOSED', 'DATA_INVALID', 'INVALID']).has(String(quality.status ?? '').toUpperCase());
  const admission = record.metadata?.context?.marketAdmission ?? record.metadata?.marketAdmission ?? null;
  const admissionRejected = admission?.state === 'REJECTED';
  return quality.valid !== false && !technicalBlock && !invalidStatus && !admissionRejected;
}

function evidenceRecords(store) {
  return store.list().filter(isValidEvidenceRecord);
}

function learningSnapshot(store) {
  const records = evidenceRecords(store);
  const minimumSamples = Number(process.env.WILL_CALIBRATION_MINIMUM_SAMPLES || 30);
  return {
    metrics: summarize(records),
    calibration: buildConfidenceCalibration(records, { minimumSamples }),
    readiness: buildLearningReadiness(records, { minimumSamples }),
    lab: buildLearningLab(records, { minimumOutcomes: minimumSamples })
  };
}

router.get('/history', (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 1_000);
    const records = evidenceRecords(storeFor(req));
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
    if (!isValidEvidenceRecord(current)) throw new Error('Registro técnico/inválido não pode receber resultado operacional.');
    if (current.execution?.status !== 'CONFIRMED') {
      throw new Error('Confirme a entrada realmente executada antes de registrar WIN ou LOSS.');
    }
    if (current.metadata?.prospective?.experimentId) {
      const temporalGate = prospectiveOutcomeDue(current);
      if (!temporalGate.allowed) throw new Error(`Resultado prospectivo só pode ser registrado após a expiração (${temporalGate.dueAt ?? 'indisponível'}).`);
    }
    const record = storeFor(req).settle(req.params.id, outcome, { ...metadata, exitPrice, recordedBy: 'operator' });
    return res.json({ ok: true, record, learning: learningSnapshot(storeFor(req)) });
  } catch (error) {
    return res.status(error.message === 'Sinal não encontrado.' ? 404 : 400).json({ ok: false, error: error.message });
  }
});

router.post('/history/:id/executed', (req, res) => {
  try {
    const current = storeFor(req).list().find((item) => item.id === req.params.id);
    if (!current) throw new Error('Sinal não encontrado.');
    if (!isValidEvidenceRecord(current)) throw new Error('Registro técnico/inválido não pode ser confirmado como execução.');
    const record = storeFor(req).confirmExecution(req.params.id, req.body ?? {});
    return res.json({ ok: true, record });
  } catch (error) {
    return res.status(error.message === 'Sinal não encontrado.' ? 404 : 400).json({ ok: false, error: error.message });
  }
});

router.post('/history/resolve', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.body?.limit || 1), 1), 3);
    const open = evidenceRecords(storeFor(req)).filter((record) => record.status === 'OPEN').slice(0, limit);
    const resolved = [];
    const pending = [];
    for (const record of open) {
      const resolverStartedAt = Date.now();
      const snapshot = await getLocalRelaySnapshot(record.asset, record.timeframe || '1min', 50);
      const outcome = resolveProspectiveOutcome(record, { price: snapshot.price, timestamp: snapshot.timestamp, valid: snapshot.valid, status: snapshot.status });
      if (!outcome.resolved) {
        pending.push({ id: record.id, reason: outcome.reason, dueAt: outcome.dueAt });
        continue;
      }
      resolved.push(storeFor(req).settle(record.id, outcome.outcome, {
        exitPrice: outcome.exitPrice,
        source: 'market-relay-prospective-paper',
        referenceTimestamp: outcome.referenceTimestamp,
        dueAt: outcome.dueAt,
        resolverLatencyMs: Date.now() - resolverStartedAt,
        resolutionReason: outcome.reason ?? null
      }));
    }
    return res.json({ ok: true, resolved, pending });
  } catch (error) {
    return res.status(503).json({ ok: false, error: error.message });
  }
});

router.get('/metrics', (req, res) => {
  try {
    const records = evidenceRecords(storeFor(req));
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
      learning: buildLearningReadiness(records, { minimumSamples }),
      lab: buildLearningLab(records, { minimumOutcomes: minimumSamples })
    });
  } catch (error) {
    return res.status(503).json({ ok: false, error: error.message });
  }
});

export default router;
