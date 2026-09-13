import { Router } from 'express';
import { buildCandleContext } from '../../../data/src/candleContext.js';

const router=Router();
router.post('/context', (req,res)=>{
  const result=buildCandleContext(req.body?.candles, { maxCandles: Math.min(Number(req.body?.maxCandles)||100, 200) });
  return res.status(result.valid?200:422).json({ok:result.valid, context:result});
});
export default router;
