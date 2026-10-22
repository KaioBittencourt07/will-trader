const BANDS = Object.freeze([
  { label: '0-49', min: 0, max: 50 },
  { label: '50-59', min: 50, max: 60 },
  { label: '60-69', min: 60, max: 70 },
  { label: '70-79', min: 70, max: 80 },
  { label: '80-89', min: 80, max: 90 },
  { label: '90-100', min: 90, max: 101 }
]);
const SAMPLE_ROLES = new Set(['UNSPECIFIED', 'TRAIN', 'VALIDATION', 'TEST', 'PROSPECTIVE']);

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

function bandFor(score) {
  return BANDS.find((band) => score >= band.min && score < band.max) ?? null;
}

function newBucket(band) {
  return {
    band: band.label,
    scoreMinInclusive: band.min,
    scoreMaxExclusive: band.max === 101 ? 101 : band.max,
    directionalCandidates: 0,
    settledTrades: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    unresolvedTrades: 0,
    binaryN: 0,
    observedBinaryWinRate: null,
    wilsonInterval95: null,
    status: 'INSUFFICIENT_SAMPLE'
  };
}

/**
 * Diagnoses association between the WILL's heuristic confidence score and
 * caller-supplied historical outcomes. It does NOT calibrate the score, assign
 * a probability, train a mapping, choose thresholds, or prove financial edge.
 *
 * "TEST" and "PROSPECTIVE" are caller-declared sample roles, not authenticated
 * leakage guarantees. Preserve the frozen strategy and perform all tuning away
 * from the final test slice.
 */
export function buildConfidenceDiagnostics({
  decisions,
  results,
  sampleRole = 'UNSPECIFIED',
  minimumBinaryPerBand = 30,
  minimumTotalBinary = 100
} = {}) {
  if (!Array.isArray(decisions) || !Array.isArray(results)) {
    throw new TypeError('CONFIDENCE_DIAGNOSTICS_ARRAYS_REQUIRED');
  }
  const normalizedRole = typeof sampleRole === 'string' ? sampleRole.toUpperCase() : '';
  if (!SAMPLE_ROLES.has(normalizedRole)) throw new Error('CONFIDENCE_SAMPLE_ROLE_INVALID');
  if (!Number.isInteger(minimumBinaryPerBand) || minimumBinaryPerBand < 1) {
    throw new Error('CONFIDENCE_MINIMUM_BAND_SAMPLE_INVALID');
  }
  if (!Number.isInteger(minimumTotalBinary) || minimumTotalBinary < 1) {
    throw new Error('CONFIDENCE_MINIMUM_TOTAL_SAMPLE_INVALID');
  }

  const resultById = new Map();
  for (const result of results) {
    if (!result || typeof result !== 'object' || Array.isArray(result) ||
        typeof result.id !== 'string' || !result.id) throw new Error('CONFIDENCE_RESULT_ID_INVALID');
    if (resultById.has(result.id)) throw new Error('CONFIDENCE_RESULT_ID_DUPLICATE');
    resultById.set(result.id, result);
  }

  const decisionIds = new Set();
  const buckets = new Map(BANDS.map((band) => [band.label, newBucket(band)]));
  const counts = {
    decisions: decisions.length,
    waitDecisions: 0,
    blockedDecisions: 0,
    nonActionableDecisions: 0,
    directionalCandidates: 0,
    settledTrades: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    unresolvedTrades: 0,
    missingResults: 0,
    orphanResults: 0,
    invalidConfidenceScores: 0
  };
  const overall = [];

  for (const decision of decisions) {
    if (!decision || typeof decision !== 'object' || Array.isArray(decision) ||
        typeof decision.id !== 'string' || !decision.id) throw new Error('CONFIDENCE_DECISION_ID_INVALID');
    if (decisionIds.has(decision.id)) throw new Error('CONFIDENCE_DECISION_ID_DUPLICATE');
    decisionIds.add(decision.id);

    const direction = typeof decision.direction === 'string' ? decision.direction.toUpperCase() : '';
    const confidence = Number(decision.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
      counts.invalidConfidenceScores++;
    }
    const isDirectionalCandidate = ['BUY', 'SELL'].includes(direction) &&
      decision.blocked !== true && decision.executable === true;

    if (direction === 'WAIT') counts.waitDecisions++;
    else if (decision.blocked === true) counts.blockedDecisions++;
    else if (!['BUY', 'SELL'].includes(direction) || decision.executable !== true) counts.nonActionableDecisions++;

    if (!isDirectionalCandidate) continue;
    counts.directionalCandidates++;

    const bucket = Number.isFinite(confidence) && confidence >= 0 && confidence <= 100
      ? buckets.get(bandFor(confidence)?.label)
      : null;
    if (bucket) bucket.directionalCandidates++;

    const result = resultById.get(decision.id);
    if (!result) {
      counts.missingResults++;
      counts.unresolvedTrades++;
      if (bucket) bucket.unresolvedTrades++;
      continue;
    }

    if (result.status === 'SETTLED' && ['WIN', 'LOSS', 'TIE'].includes(result.outcome)) {
      counts.settledTrades++;
      if (bucket) bucket.settledTrades++;
      overall.push(result.outcome);
      if (result.outcome === 'WIN') {
        counts.wins++;
        if (bucket) bucket.wins++;
      } else if (result.outcome === 'LOSS') {
        counts.losses++;
        if (bucket) bucket.losses++;
      } else {
        counts.ties++;
        if (bucket) bucket.ties++;
      }
    } else if (result.status === 'UNRESOLVED') {
      counts.unresolvedTrades++;
      if (bucket) bucket.unresolvedTrades++;
    } else if (result.status === 'BLOCKED') {
      counts.blockedDecisions++;
    } else if (result.status === 'WAIT') {
      counts.waitDecisions++;
    } else {
      throw new Error('CONFIDENCE_RESULT_STATE_INVALID');
    }
  }

  counts.orphanResults = [...resultById.keys()].filter((id) => !decisionIds.has(id)).length;
  for (const bucket of buckets.values()) {
    bucket.binaryN = bucket.wins + bucket.losses;
    bucket.observedBinaryWinRate = bucket.binaryN ? bucket.wins / bucket.binaryN : null;
    bucket.wilsonInterval95 = wilsonInterval95(bucket.wins, bucket.losses);
    bucket.status = bucket.binaryN >= minimumBinaryPerBand
      ? 'DESCRIPTIVE_ONLY'
      : 'INSUFFICIENT_SAMPLE';
  }

  const binaryN = counts.wins + counts.losses;
  const roleIsPotentiallyOutOfSample = ['TEST', 'PROSPECTIVE'].includes(normalizedRole);
  const noTradeRate = counts.decisions
    ? (counts.waitDecisions + counts.blockedDecisions + counts.nonActionableDecisions) / counts.decisions
    : null;

  const reasonCodes = [];
  if (!roleIsPotentiallyOutOfSample) reasonCodes.push('SAMPLE_ROLE_NOT_OUT_OF_SAMPLE');
  if (binaryN < minimumTotalBinary) reasonCodes.push('TOTAL_BINARY_SAMPLE_TOO_SMALL');
  if (counts.unresolvedTrades > 0) reasonCodes.push('UNRESOLVED_OR_MISSING_RESULTS');
  if (counts.orphanResults > 0) reasonCodes.push('ORPHAN_RESULTS_PRESENT');
  if (counts.invalidConfidenceScores > 0) reasonCodes.push('INVALID_CONFIDENCE_SCORES_PRESENT');

  return Object.freeze({
    schemaVersion: 'will-confidence-outcome-diagnostics-v1',
    mode: 'HEURISTIC_SCORE_ASSOCIATION_ONLY',
    sampleRole: normalizedRole,
    roleIsPotentiallyOutOfSample,
    counts,
    noTradeRate,
    binaryN,
    binaryWinRate: binaryN ? counts.wins / binaryN : null,
    wilsonInterval95: wilsonInterval95(counts.wins, counts.losses),
    minimumTotalBinary,
    minimumBinaryPerBand,
    confidenceBands: [...buckets.values()],
    confidenceSemantics: 'HEURISTIC_COMPOSITE_SCORE_NOT_PROBABILITY',
    calibrationPerformed: false,
    financialPnlComputed: false,
    edgeProven: false,
    reasonCodes,
    status: reasonCodes.length === 0
      ? 'DESCRIPTIVE_OUT_OF_SAMPLE_ASSOCIATION_READY_FOR_INDEPENDENT_REVIEW'
      : 'DESCRIPTIVE_ONLY_INSUFFICIENT_OR_UNVERIFIED_EVIDENCE',
    limitations: [
      'Sample role is declared by the caller and not independently authenticated.',
      'Wilson interval is record-level and does not correct serial correlation or multiple hypothesis testing.',
      'This module does not fit a probability calibration map, tune thresholds, or prove expectancy.',
      'WAIT and blocked decisions remain visible in the denominator; only settled directional WIN/LOSS count in binary rate.'
    ]
  });
}
