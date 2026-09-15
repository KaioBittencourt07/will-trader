export function resolveConsensus(deterministic, ai, { minimumAiConfidence = 70 } = {}) {
  const agrees = ai?.direction === deterministic?.direction;
  const strongEnough = Number(ai?.confidence) >= minimumAiConfidence;
  const approved =
    Boolean(deterministic?.executable) &&
    !ai?.block &&
    agrees &&
    strongEnough;

  if (!approved) {
    return {
      approved: false,
      decision: {
        ...deterministic,
        direction: 'WAIT',
        executable: false,
        clickTime: null,
        blocked: true,
        reason: 'Consenso não confirmado entre WILL determinístico e AI.',
        blockReasons: [
          ...(deterministic?.blockReasons ?? []),
          'AI_CONSENSUS_FAILED'
        ]
      }
    };
  }

  return {
    approved: true,
    decision: {
      ...deterministic,
      confidence: Math.round(
        (Number(deterministic.confidence ?? 0) +
          Number(ai.confidence ?? 0)) / 2
      ),
      reason: `Consenso WILL + AI: ${ai.thesis}`,
      ai: {
        direction: ai.direction,
        confidence: ai.confidence,
        score: ai.score,
        risks: ai.risks
      },

      // IMPORTANTE:
      // preserva o horário calculado pelo Execution Timing.
      clickTime: deterministic.clickTime,
      timing: deterministic.timing
    }
  };
}

export function resolveAdvisorConsensus(deterministic, reviews = [], { minimumAiConfidence = 70 } = {}) {
  const failed = reviews.filter((review) => review.block || review.direction !== deterministic.direction || Number(review.confidence) < minimumAiConfidence);
  if (!reviews.length || failed.length) {
    return { approved: false, decision: { ...deterministic, direction: 'WAIT', executable: false, clickTime: null, blocked: true, reason: 'Consenso de revisores não confirmado.', blockReasons: [...(deterministic.blockReasons ?? []), 'AI_CONSENSUS_FAILED'], advisors: reviews } };
  }
  return { approved: true, decision: { ...deterministic, confidence: Math.round((Number(deterministic.confidence) + reviews.reduce((sum, review) => sum + Number(review.confidence), 0)) / (reviews.length + 1)), reason: `Consenso WILL + ${reviews.map((review) => review.source).join(' + ')}.`, advisors: reviews } };
}
