export function timeSplit(records = [], { train = 0.6, validation = 0.2 } = {}) {
  const ordered = [...records].sort((a, b) => Date.parse(a?.timestamp) - Date.parse(b?.timestamp));
  if (train <= 0 || validation <= 0 || train + validation >= 1) throw new Error('Percentuais inválidos.');
  const trainEnd = Math.floor(ordered.length * train);
  const validationEnd = trainEnd + Math.floor(ordered.length * validation);
  return {
    train: ordered.slice(0, trainEnd),
    validation: ordered.slice(trainEnd, validationEnd),
    test: ordered.slice(validationEnd)
  };
}
