const ASSET_PATTERN = /^[A-Z0-9][A-Z0-9._:/-]{0,31}$/;
const ISO_TIMESTAMP_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function timestampMs(value) {
  if (typeof value !== 'string' || !ISO_TIMESTAMP_WITH_ZONE.test(value)) return NaN;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : NaN;
}

function assetKey(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function positiveFinite(value) {
  const result = Number(value);
  return Number.isFinite(result) && result > 0 ? result : null;
}

function wilsonInterval95(wins, losses) {
  const n = wins + losses;
  if (!n) return null;
  const z = 1.959963984540054;
  const p = wins / n;
  const denominator = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denominator;
  const half = z * Math.sqrt((p * (1 - p) / n) + (z * z / (4 * n * n))) / denominator;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

function lowerBound(observations, targetMs) {
  let low = 0;
  let high = observations.length;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (observations[mid].timestampMs < targetMs) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * Validates point-in-time price observations without silently dropping bad rows.
 * Timestamp strings must carry an explicit UTC marker or numeric UTC offset.
 * A valid report describes data shape; it does not authenticate the data source.
 */
export function validatePriceObservations(records) {
  if (!Array.isArray(records)) throw new TypeError('OBSERVATIONS_MUST_BE_AN_ARRAY');

  const normalized = [];
  const seen = new Set();
  const reasonCodes = new Set();
  let invalidRows = 0;
  let duplicateCount = 0;

  records.forEach((record) => {
    const reasons = [];
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      invalidRows++;
      reasonCodes.add('INVALID_RECORD');
      return;
    }

    const asset = assetKey(record.asset);
    const time = timestampMs(record.timestamp);
    const price = positiveFinite(record.price);
    if (!ASSET_PATTERN.test(asset)) reasons.push('INVALID_ASSET');
    if (!Number.isFinite(time)) reasons.push('INVALID_TIMESTAMP_WITH_TIMEZONE');
    if (price === null) reasons.push('INVALID_PRICE');

    if (reasons.length) {
      invalidRows++;
      reasons.forEach((reason) => reasonCodes.add(reason));
      return;
    }

    const key = `${asset}|${time}`;
    if (seen.has(key)) {
      duplicateCount++;
      invalidRows++;
      reasonCodes.add('DUPLICATE_ASSET_TIMESTAMP');
      return;
    }

    seen.add(key);
    normalized.push({
      ...record,
      asset,
      timestamp: new Date(time).toISOString(),
      timestampMs: time,
      price
    });
  });

  normalized.sort((a, b) => a.timestampMs - b.timestampMs || a.asset.localeCompare(b.asset));
  return Object.freeze({
    schemaVersion: 'will-price-observation-validation-v1',
    valid: reasonCodes.size === 0 && normalized.length === records.length,
    inputCount: records.length,
    validCount: normalized.length,
    invalidRows,
    duplicateCount,
    reasonCodes: [...reasonCodes].sort(),
    observations: normalized
  });
}

function validateReplayOptions({ expirySeconds, entryDelayMs, stake, payoutRatio, costPerTrade, minimumBinaryTrades }) {
  if (!Number.isInteger(expirySeconds) || expirySeconds <= 0) throw new Error('INVALID_EXPIRY_SECONDS');
  if (!Number.isInteger(entryDelayMs) || entryDelayMs < 0) throw new Error('INVALID_ENTRY_DELAY_MS');
  if (!Number.isFinite(stake) || stake <= 0) throw new Error('INVALID_STAKE');
  if (payoutRatio !== null && (!Number.isFinite(payoutRatio) || payoutRatio <= 0 || payoutRatio > 10)) {
    throw new Error('INVALID_PAYOUT_RATIO');
  }
  if (!Number.isFinite(costPerTrade) || costPerTrade < 0) throw new Error('INVALID_COST_PER_TRADE');
  if (!Number.isInteger(minimumBinaryTrades) || minimumBinaryTrades < 1) throw new Error('INVALID_MINIMUM_BINARY_TRADES');
}

/**
 * Replays decisions against caller-supplied point-in-time prices.
 *
 * Entry uses the first observation strictly after the decision timestamp and at
 * or after the configured delay. Expiry uses the first observation at or after
 * entryTimestamp + expirySeconds. Thus a price used to create a decision cannot
 * also fill it, and a future price cannot be used before its timestamp.
 *
 * This function is descriptive, not an edge-certification gate. It never returns
 * edgeProven=true. Provenance, spread, slippage, venue execution and quote quality
 * still require independent evidence.
 */
export function runHistoricalReplay({
  decisions,
  observations,
  expirySeconds = 60,
  entryDelayMs = 250,
  payoutRatio = null,
  stake = 1,
  costPerTrade = 0,
  minimumBinaryTrades = 100
} = {}) {
  validateReplayOptions({ expirySeconds, entryDelayMs, stake, payoutRatio, costPerTrade, minimumBinaryTrades });
  if (!Array.isArray(decisions)) throw new TypeError('DECISIONS_MUST_BE_AN_ARRAY');

  const dataReport = validatePriceObservations(observations);
  if (!dataReport.valid) {
    throw new Error(`INVALID_MARKET_DATASET:${dataReport.reasonCodes.join(',')}`);
  }

  const quotesByAsset = new Map();
  for (const observation of dataReport.observations) {
    const quotes = quotesByAsset.get(observation.asset) ?? [];
    quotes.push(observation);
    quotesByAsset.set(observation.asset, quotes);
  }

  const seenDecisionIds = new Set();
  const prepared = decisions.map((decision, index) => {
    if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
      throw new Error(`INVALID_DECISION_RECORD:${index}`);
    }
    const asset = assetKey(decision.asset);
    const time = timestampMs(decision.decisionTimestamp ?? decision.timestamp);
    const direction = typeof decision.direction === 'string' ? decision.direction.toUpperCase() : '';
    const id = decision.id === undefined || decision.id === null || decision.id === ''
      ? `decision-${index + 1}`
      : String(decision.id);
    if (!ASSET_PATTERN.test(asset)) throw new Error(`INVALID_DECISION_ASSET:${index}`);
    if (!Number.isFinite(time)) throw new Error(`INVALID_DECISION_TIMESTAMP:${index}`);
    if (!['BUY', 'SELL', 'WAIT'].includes(direction)) throw new Error(`INVALID_DECISION_DIRECTION:${index}`);
    if (seenDecisionIds.has(id)) throw new Error('DUPLICATE_DECISION_ID');
    seenDecisionIds.add(id);
    return { decision, index, id, asset, time, direction };
  }).sort((a, b) => a.time - b.time || a.index - b.index);

  const results = [];
  for (const item of prepared) {
    const { decision, id, asset, time, direction } = item;
    const decisionTime = new Date(time).toISOString();

    if (direction === 'WAIT') {
      results.push({ id, asset, direction, decisionTimestamp: decisionTime, status: 'WAIT', reasonCode: 'DECISION_WAIT' });
      continue;
    }
    if (decision.blocked === true) {
      results.push({ id, asset, direction, decisionTimestamp: decisionTime, status: 'BLOCKED', reasonCode: 'SIGNAL_BLOCKED' });
      continue;
    }
    if (decision.executable !== true) {
      results.push({ id, asset, direction, decisionTimestamp: decisionTime, status: 'BLOCKED', reasonCode: 'SIGNAL_NOT_EXECUTABLE' });
      continue;
    }

    const quotes = quotesByAsset.get(asset) ?? [];
    const entryTarget = time + Math.max(1, entryDelayMs);
    const entryIndex = lowerBound(quotes, entryTarget);
    const entry = quotes[entryIndex];
    if (!entry) {
      results.push({ id, asset, direction, decisionTimestamp: decisionTime, status: 'UNRESOLVED', reasonCode: 'NO_POST_DECISION_ENTRY_QUOTE' });
      continue;
    }

    const expiryTarget = entry.timestampMs + expirySeconds * 1_000;
    const exitIndex = lowerBound(quotes, expiryTarget);
    const exit = quotes[exitIndex];
    if (!exit || exit.timestampMs <= entry.timestampMs) {
      results.push({
        id, asset, direction, decisionTimestamp: decisionTime,
        entryTimestamp: entry.timestamp, entryPrice: entry.price,
        targetExpiryTimestamp: new Date(expiryTarget).toISOString(),
        status: 'UNRESOLVED', reasonCode: 'NO_POST_EXPIRY_SETTLEMENT_QUOTE'
      });
      continue;
    }

    const outcome = exit.price === entry.price
      ? 'TIE'
      : ((direction === 'BUY' && exit.price > entry.price) || (direction === 'SELL' && exit.price < entry.price))
        ? 'WIN'
        : 'LOSS';
    const pnl = payoutRatio === null
      ? null
      : outcome === 'WIN' ? stake * payoutRatio - costPerTrade
        : outcome === 'LOSS' ? -stake - costPerTrade
          : -costPerTrade;

    results.push({
      id, asset, direction, decisionTimestamp: decisionTime,
      entryTimestamp: entry.timestamp, entryPrice: entry.price,
      targetExpiryTimestamp: new Date(expiryTarget).toISOString(),
      settlementTimestamp: exit.timestamp, settlementPrice: exit.price,
      expiryDelayMs: exit.timestampMs - expiryTarget,
      outcome, pnl, status: 'SETTLED'
    });
  }

  const settled = results.filter((row) => row.status === 'SETTLED');
  const wins = settled.filter((row) => row.outcome === 'WIN').length;
  const losses = settled.filter((row) => row.outcome === 'LOSS').length;
  const ties = settled.filter((row) => row.outcome === 'TIE').length;
  const binaryN = wins + losses;
  const unresolved = results.filter((row) => row.status === 'UNRESOLVED').length;
  const blocked = results.filter((row) => row.status === 'BLOCKED').length;
  const waits = results.filter((row) => row.status === 'WAIT').length;
  const actionable = wins + losses + ties + unresolved;
  const decisionCount = results.length;
  const completeness = unresolved === 0;
  const netPnl = payoutRatio !== null && completeness
    ? settled.reduce((sum, row) => sum + row.pnl, 0)
    : null;
  const settledNetPnl = payoutRatio !== null
    ? settled.reduce((sum, row) => sum + row.pnl, 0)
    : null;

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let currentLossStreak = 0;
  let maxLossStreak = 0;
  for (const row of results) {
    if (row.status !== 'SETTLED') continue;
    if (row.outcome === 'LOSS') {
      currentLossStreak++;
      maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
    } else {
      currentLossStreak = 0;
    }
    if (row.pnl !== null) {
      equity += row.pnl;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, peak - equity);
    }
  }

  const reasons = [];
  if (binaryN < minimumBinaryTrades) reasons.push('SAMPLE_BELOW_CONFIGURED_MINIMUM');
  if (unresolved > 0) reasons.push('UNRESOLVED_TRADES_PRESENT');
  if (payoutRatio === null) reasons.push('PAYOUT_RATIO_REQUIRED_FOR_FINANCIAL_METRICS');
  if (dataReport.observations.length === 0) reasons.push('NO_MARKET_OBSERVATIONS');

  return Object.freeze({
    schemaVersion: 'will-historical-replay-report-v1',
    mode: 'HISTORICAL_DESCRIPTIVE_ONLY',
    decisionCount,
    waitCount: waits,
    blockedCount: blocked,
    actionableSignals: actionable,
    settledTrades: settled.length,
    wins, losses, ties, binaryN,
    unresolvedTrades: unresolved,
    noTradeRate: decisionCount ? (waits + blocked) / decisionCount : null,
    actionableRate: decisionCount ? actionable / decisionCount : null,
    settlementCoverage: actionable ? settled.length / actionable : null,
    binaryWinRate: binaryN ? wins / binaryN : null,
    wilsonInterval95: wilsonInterval95(wins, losses),
    wilsonIntervalMethod: 'WILSON_95_BINOMIAL_RECORD_LEVEL_NOT_ADJUSTED_FOR_SERIAL_DEPENDENCE',
    payoutRatio,
    stake,
    costPerTrade,
    breakEvenWinRateWithoutTies: payoutRatio === null ? null : (stake + costPerTrade) / (stake * (1 + payoutRatio)),
    settledNetPnl,
    netPnl,
    expectancyPerSettledTrade: netPnl !== null && settled.length ? netPnl / settled.length : null,
    maxDrawdown: netPnl !== null ? maxDrawdown : null,
    maxLossStreak,
    statisticalReviewReady: binaryN >= minimumBinaryTrades && unresolved === 0 && payoutRatio !== null,
    status: !completeness ? 'INCOMPLETE_UNRESOLVED_TRADES'
      : payoutRatio === null ? 'DESCRIPTIVE_ONLY_PAYOUT_REQUIRED'
        : binaryN < minimumBinaryTrades ? 'DESCRIPTIVE_ONLY_SAMPLE_TOO_SMALL'
          : 'READY_FOR_STATISTICAL_REVIEW_NOT_EDGE_PROOF',
    edgeProven: false,
    reasonCodes: reasons,
    marketData: {
      inputCount: dataReport.inputCount,
      validCount: dataReport.validCount,
      invalidRows: dataReport.invalidRows,
      duplicateCount: dataReport.duplicateCount,
      timestampContract: 'ISO-8601-with-explicit-timezone',
      provenance: 'CALLER_SUPPLIED_NOT_AUTHENTICATED'
    },
    executionAssumptions: {
      entryRule: 'first quote strictly after decision time and at/after configured delay',
      expiryRule: 'first quote at/after entry timestamp plus expiry seconds',
      quoteDelayMode: 'measured by settlement timestamp against target expiry',
      spreadSlippageAndBrokerFill: 'NOT_MODELED',
      decisionsUseSameTimestampQuoteForEntry: false,
      payoutRatioSuppliedByCaller: payoutRatio !== null
    },
    results
  });
}

/**
 * Chronological train/validation/test split. Records sharing a timestamp are
 * kept together, and embargo windows can be used to avoid label-horizon leakage.
 */
export function splitChronologically(records, {
  trainRatio = 0.6,
  validationRatio = 0.2,
  embargoMs = 0,
  timestampField = 'timestamp'
} = {}) {
  if (!Array.isArray(records)) throw new TypeError('SPLIT_RECORDS_MUST_BE_AN_ARRAY');
  if (!Number.isFinite(trainRatio) || trainRatio <= 0 ||
      !Number.isFinite(validationRatio) || validationRatio <= 0 ||
      trainRatio + validationRatio >= 1) throw new Error('INVALID_SPLIT_RATIOS');
  if (!Number.isInteger(embargoMs) || embargoMs < 0) throw new Error('INVALID_EMBARGO_MS');
  if (typeof timestampField !== 'string' || !timestampField) throw new Error('INVALID_TIMESTAMP_FIELD');

  const ordered = records.map((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('INVALID_SPLIT_RECORD');
    const time = timestampMs(record[timestampField]);
    if (!Number.isFinite(time)) throw new Error('INVALID_SPLIT_TIMESTAMP');
    return { record, index, time };
  }).sort((a, b) => a.time - b.time || a.index - b.index);

  const groups = [];
  for (const row of ordered) {
    const last = groups.at(-1);
    if (last && last.timestampMs === row.time) last.rows.push(row);
    else groups.push({ timestampMs: row.time, rows: [row] });
  }
  if (groups.length < 3) throw new Error('INSUFFICIENT_UNIQUE_TIMESTAMPS');

  const trainGroupCount = Math.max(1, Math.floor(groups.length * trainRatio));
  const validationGroupCount = Math.max(1, Math.floor(groups.length * validationRatio));
  const trainGroups = groups.slice(0, trainGroupCount);
  const trainBoundary = trainGroups.at(-1).timestampMs;
  const afterTrain = groups.slice(trainGroupCount).filter((group) => group.timestampMs > trainBoundary + embargoMs);
  const validationGroups = afterTrain.slice(0, validationGroupCount);
  if (trainGroups.length === 0 || validationGroups.length === 0) throw new Error('INSUFFICIENT_DATA_AFTER_TRAIN_EMBARGO');

  const validationBoundary = validationGroups.at(-1).timestampMs;
  const afterValidation = groups.filter((group) => group.timestampMs > validationBoundary + embargoMs &&
    group.timestampMs > trainBoundary);
  const validationKeys = new Set(validationGroups.map((group) => group.timestampMs));
  const trainKeys = new Set(trainGroups.map((group) => group.timestampMs));
  const testGroups = afterValidation.filter((group) => !validationKeys.has(group.timestampMs) && !trainKeys.has(group.timestampMs));
  if (testGroups.length === 0) throw new Error('INSUFFICIENT_DATA_AFTER_VALIDATION_EMBARGO');

  const collect = selected => selected.flatMap(group => group.rows.map(row => row.record));
  const assigned = new Set([...trainGroups, ...validationGroups, ...testGroups].map(group => group.timestampMs));
  const excludedByEmbargo = groups.filter(group => !assigned.has(group.timestampMs)).reduce((sum, group) => sum + group.rows.length, 0);

  const summary = selected => ({
    count: selected.reduce((sum, group) => sum + group.rows.length, 0),
    uniqueTimestamps: selected.length,
    from: new Date(selected[0].timestampMs).toISOString(),
    to: new Date(selected.at(-1).timestampMs).toISOString()
  });

  return Object.freeze({
    schemaVersion: 'will-temporal-split-v1',
    train: collect(trainGroups),
    validation: collect(validationGroups),
    test: collect(testGroups),
    summary: {
      train: summary(trainGroups),
      validation: summary(validationGroups),
      test: summary(testGroups),
      embargoMs,
      excludedByEmbargo,
      uniqueTimestampGroups: groups.length,
      noTimestampGroupSplit: true
    }
  });
}
