export function calibrateConfidence({ technical = 0, regime = 0, setup = 0, sampleSize = 0, blocked = false }) {
  if (blocked) return 0;
  const evidence = (Number(technical) * 0.4) + (Number(regime) * 0.25) + (Number(setup) * 0.25) + Math.min(Number(sampleSize), 100) * 0.1;
  const samplePenalty = sampleSize < 20 ? 15 : sampleSize < 50 ? 8 : 0;
  return Math.max(0, Math.min(100, Math.round(evidence - samplePenalty)));
}
