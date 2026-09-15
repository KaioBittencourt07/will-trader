import { Router } from 'express';
import { buildChatMarketPacket, buildMarketIntelligence } from '../../../context/src/marketIntelligenceV4.js';

const router = Router();

router.get('/intelligence', async (req, res) => {
  try {
    const asset = String(req.query.asset || process.env.DEFAULT_ASSET || 'BTC/USD').trim().toUpperCase();
    const marketContext = await req.app.locals.marketContextProvider.getContext(asset);
    const intelligence = buildMarketIntelligence({ asset, marketContext });
    const chatPacket = buildChatMarketPacket({ asset, marketContext });
    return res.json({
      ok: true,
      asset,
      intelligence,
      chatPacket,
      externalAdaptersConfigured: {
        macro: intelligence.macro.source !== null,
        news: intelligence.news.source !== null
      },
      decisionImpact: intelligence.hardBlocked ? 'BLOCK_ANALYSIS_RELEASE' : 'CONTEXT_ONLY',
      ordersExecuted: 0
    });
  } catch (error) {
    return res.status(503).json({ ok: false, error: String(error?.message || 'MARKET_INTELLIGENCE_UNAVAILABLE').slice(0, 300) });
  }
});

export default router;
