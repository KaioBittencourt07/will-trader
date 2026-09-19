import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { analyzeWithOpenAI } from './ai/openaiEngine.js';

export const OPENAI_SHADOW_COMMISSION_VERSION = 'openai-shadow-commission-v1';

function validReview(review) {
  return Boolean(
    review
    && ['BUY', 'SELL', 'WAIT'].includes(review.direction)
    && Number.isFinite(Number(review.score))
    && Number(review.score) >= 0
    && Number(review.score) <= 100
    && Number.isFinite(Number(review.confidence))
    && Number(review.confidence) >= 0
    && Number(review.confidence) <= 100
    && typeof review.thesis === 'string'
    && Array.isArray(review.confirmations)
    && Array.isArray(review.risks)
    && typeof review.block === 'boolean'
  );
}

export function buildOpenAIShadowCommissionFixture() {
  return Object.freeze({
    purpose: 'WILL_OPENAI_SHADOW_COMMISSIONING_ONLY',
    fixture: true,
    executionAllowed: false,
    deterministicDecision: {
      asset: 'BTC/USD',
      timeframe: '1min',
      direction: 'SELL',
      score: 82,
      confidence: 76,
      blocked: false,
      releaseEligible: true,
      executable: false,
      reason: 'SYNTHETIC_COMMISSION_FIXTURE'
    },
    marketIntelligence: {
      coverage: 'PARTIAL',
      macro: { available: true, status: 'LOW', freshness: 'FRESH', blocked: false },
      news: { available: false, status: 'NEWS_UNKNOWN', freshness: 'UNKNOWN', blocked: false }
    },
    instructions: [
      'REVIEW_ONLY',
      'DO_NOT_CREATE_OPPOSITE_DIRECTION',
      'SELL_OR_WAIT_ONLY_FOR_THIS_FIXTURE',
      'NO_ORDER_EXECUTION',
      'UNKNOWN_REMAINS_UNKNOWN'
    ]
  });
}

export async function runOpenAIShadowCommissioning({
  analyze = analyzeWithOpenAI,
  model = process.env.OPENAI_MODEL || 'gpt-5.6-luna',
  apiKeyConfigured = Boolean(process.env.OPENAI_API_KEY),
  now = () => Date.now()
} = {}) {
  const startedAt = now();
  const baseDirection = 'SELL';
  const base = {
    version: OPENAI_SHADOW_COMMISSION_VERSION,
    mode: 'SHADOW_REVIEW_ONLY',
    provider: 'OPENAI',
    model,
    requestBudget: 1,
    requestsMade: 0,
    fixture: 'SYNTHETIC_NON_TRADING_FIXTURE',
    deterministicDirection: baseDirection,
    decisionImpact: 'NONE',
    automatedBrokerExecution: false,
    ordersExecuted: 0,
    secretExposed: false
  };

  if (!apiKeyConfigured) {
    return Object.freeze({
      ...base,
      status: 'BLOCKED',
      schemaApproved: false,
      semanticApproved: false,
      failure: 'OPENAI_API_KEY_NOT_CONFIGURED',
      durationMs: Math.max(0, now() - startedAt)
    });
  }

  try {
    const review = await analyze(buildOpenAIShadowCommissionFixture());
    const schemaApproved = validReview(review);
    const semanticApproved = schemaApproved
      && (review.direction === baseDirection || review.direction === 'WAIT');

    return Object.freeze({
      ...base,
      status: schemaApproved && semanticApproved ? 'APPROVED' : 'BLOCKED',
      requestsMade: 1,
      schemaApproved,
      semanticApproved,
      review: schemaApproved ? Object.freeze({
        direction: review.direction,
        score: Number(review.score),
        confidence: Number(review.confidence),
        block: review.block,
        thesis: review.thesis,
        confirmations: [...review.confirmations],
        risks: [...review.risks]
      }) : null,
      failure: schemaApproved
        ? (semanticApproved ? null : 'OPENAI_SHADOW_DIRECTION_BOUNDARY_VIOLATION')
        : 'OPENAI_SHADOW_SCHEMA_INVALID',
      durationMs: Math.max(0, now() - startedAt)
    });
  } catch (error) {
    return Object.freeze({
      ...base,
      status: 'BLOCKED',
      requestsMade: 1,
      schemaApproved: false,
      semanticApproved: false,
      failure: String(error?.name || error?.message || 'OPENAI_SHADOW_UNKNOWN_ERROR').slice(0, 180),
      durationMs: Math.max(0, now() - startedAt)
    });
  }
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const result = await runOpenAIShadowCommissioning();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === 'APPROVED' ? 0 : 1;
}
