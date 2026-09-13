export function groupBy(records = [], fields = []) {
  const groups = new Map();
  for (const record of records) {
    const key = fields.map((field) => record?.[field] ?? 'UNKNOWN').join('|');
    const bucket = groups.get(key) ?? { key, fields: {}, records: [] };
    for (const field of fields) bucket.fields[field] = record?.[field] ?? 'UNKNOWN';
    bucket.records.push(record);
    groups.set(key, bucket);
  }
  return [...groups.values()];
}

export function analyzeSegments(records = []) {
  const dimensions = [
    ['asset'],
    ['regime'],
    ['setup'],
    ['timeframe'],
    ['asset', 'setup'],
    ['asset', 'regime'],
    ['setup', 'regime']
  ];
  return Object.fromEntries(dimensions.map((fields) => [fields.join('_'), groupBy(records, fields)]));
}
