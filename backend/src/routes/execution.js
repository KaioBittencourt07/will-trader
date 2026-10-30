import { Router } from 'express';
import { brokerReadiness } from '../execution/brokerReadiness.js';

const router = Router();

router.get('/execution/status', (req, res) => {
  return res.json({ ok: true, execution: req.app.locals.executionGateway.status() });
});

router.get('/execution/readiness', (_req, res) => {
  return res.json({ ok: true, readiness: brokerReadiness() });
});

router.post('/execution/handoff', (req, res) => {
  try {
    return res.json({ ok: true, handoff: req.app.locals.executionGateway.createHandoff(req.body?.signal) });
  } catch (error) {
    return res.status(422).json({ ok: false, error: error.message });
  }
});

export default router;
