export const HYPOTHESIS_STATUS = Object.freeze({
  OBSERVED: 'OBSERVED',
  TESTING: 'TESTING',
  VALIDATED: 'VALIDATED',
  REJECTED: 'REJECTED'
});

export function createHypothesis(statement, evidence = []) {
  return {
    id: crypto.randomUUID(),
    statement,
    evidence,
    status: HYPOTHESIS_STATUS.OBSERVED,
    createdAt: new Date().toISOString()
  };
}

export function updateHypothesis(hypothesis, status, evidence = []) {
  if (!Object.values(HYPOTHESIS_STATUS).includes(status)) throw new Error('Status inválido.');
  return { ...hypothesis, status, evidence: [...(hypothesis.evidence ?? []), ...evidence], updatedAt: new Date().toISOString() };
}
