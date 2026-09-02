const BINARY_OUTCOMES = new Set(['WIN', 'LOSS']);

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

/** Wilson interval: descriptive uncertainty for an observed binary PAPER rate. */
export function wilsonInterval(wins, total, z = 1.96) {
  if (!Number.isFinite(wins) || !Number.isFinite(total) || total <= 0) return null;
  const proportion = wins / total;
  const denominator = 1 + (z ** 2 / total);
  const centre = (proportion + (z ** 2 / (2 * total))) / denominator;
  const margin = (z * Math.sqrt((proportion * (1 - proportion) / total) + (z ** 2 / (4 * total ** 2)))) / denominator;
  return { method: 'wilson-95', lower: Math.max(0, centre - margin), upper: Math.min(1, centre + margin), n: total };
}

function outcomeKind(record = {}) {
  if (record.outcome === 'WIN' || record.outcome === 'LOSS' || record.outcome === 'TIE' || record.outcome === 'DATA_INVALID') return record.outcome;
  // VOID was the original resolver name. Read it as a tie without rewriting old evidence.
  if (record.outcome === 'VOID') return 'TIE';
  return record.status === 'OPEN' ? 'UNRESOLVED' : null;
}

function sessionFor(timestamp) {
  const hour = new Date(timestamp ?? '').getUTCHours();
  if (!Number.isFinite(hour)) return 'UNKNOWN';
  if (hour < 7) return 'ASIA_UTC';
  if (hour < 12) return 'EUROPE_UTC';
  if (hour < 21) return 'US_UTC';
  return 'PACIFIC_UTC';
}

function derivedRecord(record = {}) {
  const quality = record.metadata?.dataQuality ?? {};
  return {
    ...record,
    hour: record.hour ?? (record.signalTimestamp ? new Date(record.signalTimestamp).getUTCHours() : 'UNKNOWN'),
    session: record.session ?? sessionFor(record.signalTimestamp),
    dataQualityStatus: quality.status ?? 'UNKNOWN',
    dataQualitySource: quality.source ?? 'UNKNOWN',
    featureVersion: record.featureVersion ?? record.metadata?.featureSnapshot?.featureVersion ?? 'legacy-unversioned',
    setupType: record.setupType ?? record.setup ?? 'UNKNOWN',
    setupQuality: record.setupQuality ?? 'UNKNOWN',
    setupDirection: record.setupDirection ?? (record.direction === 'BUY' || record.direction === 'SELL' ? record.direction : 'NEUTRAL'),
    outcomeKind: outcomeKind(record)
  };
}

function numericSummary(values = []) {
  const known = values.map(number).filter((value) => value !== null);
  if (!known.length) return { n: 0, min: null, max: null, mean: null };
  return { n: known.length, min: Math.min(...known), max: Math.max(...known), mean: known.reduce((sum, value) => sum + value, 0) / known.length };
}

function addCounters(item, record) {
  item.decisions += 1;
  if (record.direction === 'BUY') item.buys += 1;
  if (record.direction === 'SELL') item.sells += 1;
  if (record.direction === 'WAIT') item.waits += 1;
  if (record.status === 'SKIPPED' || record.blocked === true) item.blocked += 1;
  if (record.execution?.status === 'CONFIRMED') item.executed += 1;
  if (record.status === 'CLOSED') item.resolved += 1;
  if (record.outcomeKind === 'WIN') item.wins += 1;
  if (record.outcomeKind === 'LOSS') item.losses += 1;
  if (record.outcomeKind === 'TIE') item.ties += 1;
  if (record.outcomeKind === 'DATA_INVALID') item.invalid += 1;
  if (record.outcomeKind === 'UNRESOLVED') item.unresolved += 1;
}

function segment(records, field) {
  const groups = new Map();
  for (const record of records) {
    const key = record[field] ?? 'UNKNOWN';
    const item = groups.get(key) ?? { key, n: 0, decisions: 0, buys: 0, sells: 0, waits: 0, blocked: 0, executed: 0, resolved: 0, wins: 0, losses: 0, ties: 0, invalid: 0, unresolved: 0 };
    item.n += 1;
    addCounters(item, record);
    groups.set(key, item);
  }
  return [...groups.values()].sort((left, right) => String(left.key).localeCompare(String(right.key))).map((item) => {
    const binaryN = item.wins + item.losses;
    return { ...item, winLossN: binaryN, winRate: ratio(item.wins, binaryN), winRateInterval95: wilsonInterval(item.wins, binaryN), waitRate: ratio(item.waits, item.decisions) };
  });
}

function legacyOutcomeGroups(records, field) {
  const groups = new Map();
  for (const record of records.filter((item) => BINARY_OUTCOMES.has(item.outcome))) {
    const key = record[field] ?? 'UNKNOWN';
    const item = groups.get(key) ?? { key, total: 0, wins: 0 };
    item.total += 1;
    if (record.outcome === 'WIN') item.wins += 1;
    groups.set(key, item);
  }
  return [...groups.values()].map((item) => ({ ...item, winRate: item.wins / item.total }));
}

function blockerDistribution(records) {
  const groups = new Map();
  for (const record of records) for (const reason of record.metadata?.blockReasons ?? []) {
    const key = String(reason || 'UNKNOWN');
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups.entries()].map(([key, n]) => ({ key, n })).sort((left, right) => right.n - left.n || left.key.localeCompare(right.key));
}

function dataQuality(records) {
  const entries = records.map((record) => record.metadata?.dataQuality ?? {});
  const knownBars = entries.filter((item) => number(item.requiredBars) !== null && number(item.candleCount) !== null);
  return {
    n: records.length,
    valid: entries.filter((item) => item.valid !== false).length,
    invalid: entries.filter((item) => item.valid === false).length,
    freshnessMs: numericSummary(entries.map((item) => item.ageMs)),
    candleCount: numericSummary(entries.map((item) => item.candleCount)),
    missingBars: { n: knownBars.length, total: knownBars.reduce((sum, item) => sum + Math.max(0, Number(item.requiredBars) - Number(item.candleCount)), 0) },
    duplicateEvents: { available: false, n: null, reason: 'Provider event sequence/hash ainda não é capturado.' },
    outOfOrderEvents: { available: false, n: null, reason: 'Provider event sequence/hash ainda não é capturado.' }
  };
}

function latency(records) {
  return {
    decisionMs: numericSummary(records.map((record) => record.metadata?.context?.decisionLatencyMs)),
    resolverMs: numericSummary(records.map((record) => record.outcomeMetadata?.resolverLatencyMs)),
    resolutionLagMs: numericSummary(records.map((record) => {
      const settled = Date.parse(record.settledAt ?? '');
      const due = Date.parse(record.outcomeMetadata?.dueAt ?? '');
      return Number.isFinite(settled) && Number.isFinite(due) ? Math.max(0, settled - due) : null;
    }))
  };
}

export function summarize(records = []) {
  const normalized = records.map(derivedRecord);
  const signals = normalized.length;
  const waits = normalized.filter((record) => record.direction === 'WAIT').length;
  const hasDataRejection = (record) => (record.metadata?.blockReasons ?? []).some((reason) => /^(DATA_QUALITY_|Dados atrasados\.)/.test(String(reason)));
  const dataRejected = normalized.filter(hasDataRejection);
  const strategyWaits = normalized.filter((record) => record.direction === 'WAIT' && !hasDataRejection(record));
  const directional = normalized.filter((record) => ['BUY', 'SELL'].includes(record.direction));
  const released = normalized.filter((record) => record.status === 'OPEN' || record.status === 'CLOSED');
  const blockedDirectional = directional.filter((record) => record.status === 'SKIPPED');
  const binaryCompleted = normalized.filter((record) => BINARY_OUTCOMES.has(record.outcome));
  const closed = normalized.filter((record) => record.status === 'CLOSED');
  const wins = binaryCompleted.filter((record) => record.outcome === 'WIN').length;
  const losses = binaryCompleted.length - wins;
  const ties = normalized.filter((record) => record.outcomeKind === 'TIE').length;
  const invalidOutcomes = normalized.filter((record) => record.outcomeKind === 'DATA_INVALID').length;
  const unresolved = normalized.filter((record) => record.outcomeKind === 'UNRESOLVED').length;
  const operatorRecorded = binaryCompleted.filter((record) => record.execution?.status === 'CONFIRMED' || record.outcomeMetadata?.recordedBy === 'operator');
  const automaticPaper = binaryCompleted.filter((record) => record.outcomeMetadata?.source === 'market-relay-prospective-paper');
  const unverifiedCompleted = binaryCompleted.filter((record) => !operatorRecorded.includes(record) && !automaticPaper.includes(record));
  const winRate = ratio(wins, binaryCompleted.length);

  return {
    // Legacy fields retain their original binary WIN/LOSS semantics.
    total: binaryCompleted.length,
    wins,
    losses,
    winRate,
    byAsset: legacyOutcomeGroups(normalized, 'asset'),
    byRegime: legacyOutcomeGroups(normalized, 'regime'),
    bySetup: legacyOutcomeGroups(normalized, 'setup'),
    byTimeframe: legacyOutcomeGroups(normalized, 'timeframe'),
    byHour: legacyOutcomeGroups(normalized, 'hour'),
    byStrategyVersion: legacyOutcomeGroups(normalized, 'strategyVersion'),
    byModelVersion: legacyOutcomeGroups(normalized, 'modelVersion'),
    signals,
    waits,
    waitRate: ratio(waits, signals),
    funnel: { observations: signals, dataRejected: dataRejected.length, strategyWaits: strategyWaits.length, directionalCandidates: directional.length, releasedTrades: released.length, blockedDirectional: blockedDirectional.length, completedTrades: binaryCompleted.length },
    provenance: { operatorRecordedOutcomes: operatorRecorded.length, automaticPaperOutcomes: automaticPaper.length, unverifiedOutcomes: unverifiedCompleted.length },

    // Evidence-first fields: every rate has an explicit applicable N.
    evidence: {
      decisionN: signals,
      resolvedN: closed.length,
      winLossN: binaryCompleted.length,
      wins,
      losses,
      ties,
      invalidOutcomes,
      unresolved,
      winRate,
      winRateInterval95: wilsonInterval(wins, binaryCompleted.length),
      executableCoverage: ratio(released.length, signals),
      directionalCoverage: ratio(directional.length, signals),
      waitRate: ratio(waits, signals),
      blockedNoTradeRate: ratio(normalized.filter((record) => record.status === 'SKIPPED' || record.blocked === true).length, signals),
      warning: binaryCompleted.length < 30 ? 'Amostra insuficiente para conclusão de desempenho; métricas são apenas descritivas.' : null
    },
    blockers: blockerDistribution(normalized),
    dataQuality: dataQuality(normalized),
    latency: latency(normalized),
    segments: {
      byStrategyVersion: segment(normalized, 'strategyVersion'),
      byModelVersion: segment(normalized, 'modelVersion'),
      byFeatureVersion: segment(normalized, 'featureVersion'),
      bySetupType: segment(normalized, 'setupType'),
      bySetupQuality: segment(normalized, 'setupQuality'),
      bySetupDirection: segment(normalized, 'setupDirection'),
      byAsset: segment(normalized, 'asset'),
      bySetup: segment(normalized, 'setup'),
      byRegime: segment(normalized, 'regime'),
      byTimeframe: segment(normalized, 'timeframe'),
      bySession: segment(normalized, 'session'),
      byHour: segment(normalized, 'hour'),
      byDataQualityStatus: segment(normalized, 'dataQualityStatus'),
      byDataQualitySource: segment(normalized, 'dataQualitySource')
    }
  };
}
