export function normalizeHistorical(records = []) {
  return records
    .map((record) => ({
      ...record,
      timestamp: record?.timestamp ?? null,
      asset: record?.asset ?? null,
      timeframe: record?.timeframe ?? null,
      price: Number(record?.price)
    }))
    .filter((record) =>
      record.asset &&
      record.timeframe &&
      Number.isFinite(Date.parse(record.timestamp)) &&
      Number.isFinite(record.price) &&
      record.price > 0
    )
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

export function validateHistorical(records = []) {
  const normalized = normalizeHistorical(records);
  return {
    valid: normalized.length === records.length,
    inputCount: records.length,
    validCount: normalized.length,
    dropped: records.length - normalized.length
  };
}
