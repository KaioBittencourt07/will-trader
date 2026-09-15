import { resolveConsensus } from './consensus.js';

export const FRESHNESS_GUARDED_CONSENSUS_VERSION = 'freshness-guarded-consensus-v1';

function blockDecision(deterministic, freshness, reason) {
  return Object.freeze({
    approved: false,
    freshnessGate: freshness?.freshnessGate ?? 'UNVERIFIED',
    authorityGate: freshness?.authorityGate ?? 'FAIL',
    decision: Object.freeze({
      ...deterministic,
      direction: 'WAIT',
      executable: false,
      clickTime: null,
      blocked: true,
      reason,
      blockReasons: Object.freeze([
        ...(deterministic?.blockReasons ?? []),
        'AUTHORITATIVE_FRESHNESS_REQUIRED'
      ])
    })
  });
}

export function resolveFreshnessGuardedConsensus(deterministic, ai, freshness, options = {}) {
  if (!freshness || freshness.authorityGate !== 'PASS') {
    return blockDecision(deterministic, freshness, 'Autoridade temporal não verificada; decisão bloqueada.');
  }

  if (freshness.freshnessGate !== 'PASS') {
    return blockDecision(deterministic, freshness, 'Freshness autoritativo não aprovado; decisão bloqueada.');
  }

  const result = resolveConsensus(deterministic, ai, options);
  return Object.freeze({
    ...result,
    version: FRESHNESS_GUARDED_CONSENSUS_VERSION,
    freshnessGate: freshness.freshnessGate,
    authorityGate: freshness.authorityGate,
    freshnessContractMs: freshness.freshnessContractMs,
    timestampAuthority: freshness.timestampAuthority,
    providerCommissioning: false,
    prospectivePaperAuthorized: false,
    ordersExecuted: 0
  });
}
