function bucket(confidence) {
  return Math.min(90, Math.max(0, Math.floor(Number(confidence) / 10) * 10));
}

export function buildConfidenceCalibration(records = [], { minimumSamples = 30 } = {}) {
  const completed = records.filter((record) => record?.outcome === 'WIN' || record?.outcome === 'LOSS');
  const groups = new Map();
  for (const record of completed) {
    const key = bucket(record.confidence);
    const item = groups.get(key) ?? { confidenceFrom: key, confidenceTo: key + 9, total: 0, wins: 0 };
    item.total += 1;
    if (record.outcome === 'WIN') item.wins += 1;
    groups.set(key, item);
  }
  return [...groups.values()].sort((a, b) => a.confidenceFrom - b.confidenceFrom).map((item) => ({ ...item, observedWinRate: item.wins / item.total, calibrated: item.total >= minimumSamples }));
}

export function buildLearningReadiness(records = [], { minimumSamples = 30 } = {}) {
  const completed = records.filter((record) => record?.outcome === 'WIN' || record?.outcome === 'LOSS');
  const remaining = Math.max(0, minimumSamples - completed.length);
  return {
    completedSignals: completed.length,
    minimumSamples,
    remainingSamples: remaining,
    calibrationReady: remaining === 0,
    state: remaining === 0 ? 'READY_FOR_REVIEW' : 'COLLECTING_EVIDENCE',
    message: remaining === 0
      ? 'Amostra mínima atingida; revise a calibração antes de alterar o motor.'
      : `Ainda são necessários ${remaining} resultados concluídos para revisar a calibração.`
  };
}
