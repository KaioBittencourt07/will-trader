export function summarize(records = []) {
  const signals = records.length;
  const waits = records.filter((r) => r?.direction === 'WAIT').length;
  const hasDataRejection = (record) => (record?.metadata?.blockReasons ?? []).some((reason) => /^(DATA_QUALITY_|Dados atrasados\.)/.test(String(reason)));
  const dataRejected = records.filter(hasDataRejection);
  const strategyWaits = records.filter((record) => record?.direction === 'WAIT' && !hasDataRejection(record));
  const directional = records.filter((record) => ['BUY', 'SELL'].includes(record?.direction));
  const released = records.filter((record) => record?.status === 'OPEN' || record?.status === 'CLOSED');
  const blockedDirectional = directional.filter((record) => record?.status === 'SKIPPED');
  const completed = records.filter((r) => r?.outcome === 'WIN' || r?.outcome === 'LOSS');
  const operatorRecorded = completed.filter((record) => record?.execution?.status === 'CONFIRMED' || record?.outcomeMetadata?.recordedBy === 'operator');
  const automaticPaper = completed.filter((record) => record?.outcomeMetadata?.source === 'market-relay-prospective-paper');
  const unverifiedCompleted = completed.filter((record) => !operatorRecorded.includes(record) && !automaticPaper.includes(record));
  const wins = completed.filter((r) => r.outcome === 'WIN').length;
  const losses = completed.length - wins;
  const winRate = completed.length ? wins / completed.length : null;

  const by = (field) => {
    const groups = new Map();
    for (const record of completed) {
      const key = record[field] ?? 'UNKNOWN';
      const item = groups.get(key) ?? { key, total: 0, wins: 0 };
      item.total += 1;
      if (record.outcome === 'WIN') item.wins += 1;
      groups.set(key, item);
    }
    return [...groups.values()].map((item) => ({ ...item, winRate: item.wins / item.total }));
  };

  return {
    total: completed.length,
    wins,
    losses,
    winRate,
    byAsset: by('asset'),
    byRegime: by('regime'),
    bySetup: by('setup'),
    byTimeframe: by('timeframe'),
    byHour: by('hour'),
    signals,
    waits,
    waitRate: signals ? waits / signals : null,
    // Operational funnel separates a true NO-TRADE decision from a record
    // rejected because the feed could not support analysis.  This prevents
    // data outages from being mistaken for a strategy that is too strict.
    funnel: {
      observations: signals,
      dataRejected: dataRejected.length,
      strategyWaits: strategyWaits.length,
      directionalCandidates: directional.length,
      releasedTrades: released.length,
      blockedDirectional: blockedDirectional.length,
      completedTrades: completed.length
    },
    provenance: {
      operatorRecordedOutcomes: operatorRecorded.length,
      automaticPaperOutcomes: automaticPaper.length,
      unverifiedOutcomes: unverifiedCompleted.length
    }
  };
}
