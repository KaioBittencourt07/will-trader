export const OOS2U_PROTOCOL = 'will-edge-gate-oos2u-v1';
export const OOS2U_REQUIRED_CANDIDATE_CYCLES = 50;

export const OOS2U_STRUCTURAL_CONTRACT = Object.freeze({
  protocolId: OOS2U_PROTOCOL,
  mode: 'PAPER_READ_ONLY',
  metric: 'MeanAbsMomentum',
  frozenThreshold: 0.599936,
  operator: '<=',
  candidateCycles: OOS2U_REQUIRED_CANDIDATE_CYCLES,
  replacement: 'NONE',
  bootstrap: Object.freeze({ unit: 'cycle', replications: 10_000, seed: 20260915, rng: 'xorshift32' }),
  officialExecutionStatus: 'PAPER_CONFIRMED',
  settlementVersion: 'paper-outcome-settlement-v2',
  outcomeSource: 'paper-live-temporal-reference-v1',
  dataInvalidPerformanceEligible: false,
  operationalFailurePerformanceEligible: false,
  expectancy: 'NOT_AVAILABLE',
  protectedProspectiveMutationIsolation: true,
  noRetuning: true,
  noEarlyStopping: true,
  noAutomaticLivePromotion: true,
  activationAuthorized: false
});

export function validateOos2uDraft(value) {
  if (!value || value.protocolId !== OOS2U_PROTOCOL || value.campaignId != null || value.edgeCut != null || value.evidenceDirectory != null) throw new Error('OOS2U_PRODUCTION_IDENTITY_NOT_ALLOWED_IN_DRAFT');
  for (const [key, expected] of Object.entries(OOS2U_STRUCTURAL_CONTRACT)) {
    if (typeof expected !== 'object' && value[key] !== expected) throw new Error(`OOS2U_CONTRACT_${key.toUpperCase()}_INVALID`);
  }
  if (value.activationAuthorized !== false) throw new Error('OOS2U_ACTIVATION_FORBIDDEN');
  return true;
}
