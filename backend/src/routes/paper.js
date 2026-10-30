import { Router } from 'express';
import { createPaperOrder } from '../../../paper/src/index.js';

const router = Router();

router.post('/paper/order', (req, res) => {
  try {
    const { signal, stake = 1 } = req.body ?? {};

    if (!signal || typeof signal !== 'object') {
      return res.status(400).json({
        ok: false,
        error: 'Sinal inv�lido.'
      });
    }

    const order = createPaperOrder(signal, { stake });

    return res.json({
      ok: true,
      order
    });
  } catch (error) {
    console.error('Paper order error:', error.message);
    return res.status(500).json({
      ok: false,
      error: 'Falha ao criar ordem PAPER.'
    });
  }
});

export default router;
