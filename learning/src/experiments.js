export function createExperiment(name, hypothesisId, baseline = null) {
  return {
    id: crypto.randomUUID(),
    name,
    hypothesisId,
    baseline,
    variants: [],
    status: 'PLANNED',
    createdAt: new Date().toISOString()
  };
}

export function addVariant(experiment, variant) {
  return {
    ...experiment,
    variants: [...experiment.variants, { ...variant, addedAt: new Date().toISOString() }]
  };
}

export function closeExperiment(experiment, result) {
  return {
    ...experiment,
    result,
    status: 'COMPLETED',
    completedAt: new Date().toISOString()
  };
}
