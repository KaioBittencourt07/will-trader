import { Router } from 'express';
import { readOos2CollectionEvidence } from '../oos2CollectionEvidence.js';
import { oos2CollectionStatus } from '../oos2CollectionStatus.js';

const router = Router();
export function getOos2CollectionStatus(req, res) {
  res.set('Cache-Control', 'no-store');
  try {
    const history = req.app.locals.historyStore.list();
    const evidence = readOos2CollectionEvidence({ stateFile: req.app.locals.oos2MonitorStateFile });
    const status = oos2CollectionStatus(history, { completedCycleIds: evidence.completedCycleIds });
    return res.json({ ok: true, ...status, completenessEvidence: evidence.completenessEvidence });
  } catch {
    // No error text, records, IDs, or filesystem details reach response or logs.
    return res.status(503).json({ ok: false, ...oos2CollectionStatus([]), completenessEvidence: 'UNAVAILABLE' });
  }
}
router.get('/oos2/collection-status', getOos2CollectionStatus);
export default router;
