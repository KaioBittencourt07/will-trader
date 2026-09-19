import { Router } from 'express';

const router = Router();

function memoryFor(req) {
  const memory = req.app.locals.researchMemory;
  if (!memory) throw new Error('Memória de pesquisa não inicializada.');
  return memory;
}

router.get('/research', (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status).toUpperCase() : null;
    return res.json({ ok: true, records: memoryFor(req).list({ status }) });
  } catch (error) {
    return res.status(503).json({ ok: false, error: error.message });
  }
});

router.post('/research', (req, res) => {
  try {
    return res.status(201).json({ ok: true, record: memoryFor(req).add(req.body) });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/research/:id/evidence', (req, res) => {
  try {
    return res.json({ ok: true, record: memoryFor(req).recordEvidence(req.params.id, req.body) });
  } catch (error) {
    return res.status(error.message === 'Hipótese não encontrada.' ? 404 : 400).json({ ok: false, error: error.message });
  }
});

router.post('/research/:id/status', (req, res) => {
  try {
    return res.json({ ok: true, record: memoryFor(req).setStatus(req.params.id, String(req.body?.status ?? '').toUpperCase(), req.body?.notes) });
  } catch (error) {
    return res.status(error.message === 'Hipótese não encontrada.' ? 404 : 400).json({ ok: false, error: error.message });
  }
});

export default router;
