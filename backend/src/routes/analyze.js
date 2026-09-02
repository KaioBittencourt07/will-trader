import { Router } from 'express';
import { collectAdvisorReviews } from '../ai/advisors.js';
import { normalizeMarketSnapshot } from '../../../data/src/marketAdapter.js';
import { runWillPipeline } from '../../../engine/src/pipeline.js';
import { createAuditEntry } from '../../../engine/src/auditLog.js';
import { resolveAdvisorConsensus } from '../consensus.js';

const router = Router();

function aiFallbackEnabled() {
  return process.env.AI_FALLBACK_ENABLED !== 'false';
}

router.post('/analyze', async (req, res) => {
  try {
    const payload = req.body;

    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({
        ok: false,
        error: 'Payload inválido.'
      });
    }

    const rawMarket = payload.market ?? payload;
    const context = payload.context ?? {};

    const normalized = normalizeMarketSnapshot(rawMarket, {
      maxAgeMs: Number(
        process.env.MARKET_MAX_AGE_MS || 30_000
      )
    });

    /*
     * DATA GUARD
     *
     * Dados inválidos não possuem direção confiável.
     * Aqui WAIT é correto.
     */
    if (!normalized.valid) {
      const decision = {
        direction: 'WAIT',
        score: 0,
        confidence: 0,
        executable: false,
        blocked: true,
        clickTime: null,
        timing: null,
        reason: `Data Guard: ${normalized.reason}`,
        blockReasons: [normalized.reason]
      };

      return res.json({
        ok: true,
        source: 'data-guard',
        decision,
        data: normalized,
        audit: createAuditEntry({
          signal: rawMarket,
          decision,
          context
        })
      });
    }

    /*
     * WILL DETERMINÍSTICO
     */
    const deterministic = runWillPipeline(
      normalized,
      context
    );

    /*
     * IMPORTANTE:
     *
     * Não transformamos BUY/SELL bloqueado em WAIT.
     *
     * O dashboard precisa saber qual direção
     * o motor encontrou, mesmo que a entrada esteja bloqueada.
     */
    if (!deterministic.executable) {
      const decision = {
        ...deterministic,
        clickTime: null,
        executable: false
      };

      return res.json({
        ok: true,
        source: 'will-deterministic',
        decision,
        data: normalized,
        audit: createAuditEntry({
          signal: normalized,
          decision,
          context
        })
      });
    }

    /*
     * SOMENTE sinais executáveis chegam à IA.
     */
    try {
      const advisors = await collectAdvisorReviews({
        market: normalized,
        context,
        deterministic
      });
      if (!advisors.reviews.length) throw new Error(advisors.failures.join(' | ') || 'Nenhum revisor AI configurado.');
      const result = resolveAdvisorConsensus(
        deterministic,
        advisors.reviews,
        {
          minimumAiConfidence:
            context.minimumAiConfidence ?? 70
        }
      );

      return res.json({
        ok: true,
        source: result.approved
          ? 'will-advisor-consensus'
          : 'will-advisor-veto',
        decision: result.decision,
        data: normalized,
        audit: createAuditEntry({
          signal: normalized,
          decision: result.decision,
          context
        })
      });
    } catch (aiError) {
      if (!aiFallbackEnabled()) {
        throw aiError;
      }

      const fallbackDecision = {
        ...deterministic,
        ai: {
          available: false
        },
        reason:
          `${deterministic.reason || 'WILL determinístico'} | ` +
          'IA indisponível; fallback determinístico ativo.'
      };

      return res.json({
        ok: true,
        source: 'will-deterministic-fallback',
        decision: fallbackDecision,
        data: normalized,
        audit: createAuditEntry({
          signal: normalized,
          decision: fallbackDecision,
          context
        })
      });
    }
  } catch (error) {
    console.error(
      'Analysis error:',
      error.message
    );

    return res.status(500).json({
      ok: false,
      error: 'Falha na análise.'
    });
  }
});

export default router;
