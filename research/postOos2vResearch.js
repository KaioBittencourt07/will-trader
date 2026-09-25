// Read-only, deterministic descriptive research over the retired OOS-2V snapshot.
// Usage: node research/postOos2vResearch.js --history PATH --evidence-dir PATH
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readOos2vFreeze } from '../backend/src/oos2vFreeze.js';
import { evaluateOos2v } from '../backend/src/evaluateOos2v.js';
import { replayEvidence } from '../backend/src/oos2rEvidence.js';
import { verifyOos2vCycle } from '../backend/src/oos2vEvidence.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const official = r => r.execution?.status === 'PAPER_CONFIRMED' &&
  r.outcomeMetadata?.settlementVersion === 'paper-outcome-settlement-v2' &&
  r.outcomeMetadata?.source === 'paper-live-temporal-reference-v1' &&
  ['WIN', 'LOSS', 'TIE'].includes(r.outcome);
const finite = x => typeof x === 'number' && Number.isFinite(x);
const clean = x => x == null || x === '' ? 'MISSING' : String(x);
const percent = (n, d) => d ? Number((100 * n / d).toFixed(2)) : null;

export function summarize(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const label = clean(key(row));
    const item = map.get(label) ?? { group: label, N: 0, WIN: 0, LOSS: 0, TIE: 0 };
    item.N++;
    item[row.outcome]++;
    map.set(label, item);
  }
  return [...map.values()].sort((a, b) => a.group.localeCompare(b.group)).map(item => ({
    ...item, binaryN: item.WIN + item.LOSS,
    binaryWR: percent(item.WIN, item.WIN + item.LOSS),
    smallN: item.WIN + item.LOSS < 10
  }));
}

function argsOf(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--history', '--evidence-dir'].includes(argv[i]) || !argv[i + 1]) throw new Error('USAGE: --history PATH --evidence-dir PATH');
    result[argv[i]] = argv[i + 1];
  }
  if (!result['--history'] || !result['--evidence-dir']) throw new Error('USAGE: --history PATH --evidence-dir PATH');
  return result;
}

export function analyze({ historyPath, evidenceDir }) {
  const retirement = JSON.parse(fs.readFileSync(path.join(root, 'backend/config/experiments/edge-gate-oos2v-retirement.json'), 'utf8'));
  const historyBytes = fs.readFileSync(historyPath);
  if (sha256(historyBytes) !== retirement.finalSnapshot.historyFileSha256) throw new Error('HISTORY_SNAPSHOT_MISMATCH');
  const history = JSON.parse(historyBytes.toString('utf8').replace(/^\uFEFF/, ''));
  if (history.length !== retirement.finalSnapshot.historyCount) throw new Error('HISTORY_COUNT_MISMATCH');
  const walBytes = fs.readFileSync(path.join(evidenceDir, 'journal.jsonl'));
  if (sha256(walBytes) !== retirement.finalSnapshot.journalSha256) throw new Error('WAL_SNAPSHOT_MISMATCH');
  const manifestFiles = fs.readdirSync(evidenceDir).filter(name => name.endsWith('.manifest.json')).sort();
  if (manifestFiles.length !== retirement.finalSnapshot.manifestCount) throw new Error('MANIFEST_COUNT_MISMATCH');
  const manifests = manifestFiles.map(name => JSON.parse(fs.readFileSync(path.join(evidenceDir, name), 'utf8')));
  const freeze = readOos2vFreeze(
    path.join(root, 'backend/config/experiments/edge-gate-oos2v-freeze.json'),
    path.join(root, 'backend/config/experiments/edge-gate-oos2v-freeze.json.sha256')
  );
  const formal = evaluateOos2v({ history, walBytes, manifests, freeze });
  if (formal.status !== 'FORMAL_FIRST_50' ||
    ['eligibleCycles', 'acceptedCycles', 'rejectedCycles', 'invalidMetricCycles', 'performanceRecords', 'WIN', 'LOSS', 'TIE', 'binaryN']
      .some(key => formal.analysis?.[key] !== retirement.formalResult.analysis?.[key])) {
    throw new Error('FORMAL_RESULT_MISMATCH');
  }
  const entries = replayEvidence(walBytes, manifests).sort((a, b) =>
    Date.parse(a.manifest.openedAt) - Date.parse(b.manifest.openedAt) || a.manifest.cycleId.localeCompare(b.manifest.cycleId));
  const checked = entries.slice(0, 50).map(entry => ({ entry, verification: verifyOos2vCycle(entry, history) }));
  if (checked.some(x => !x.verification.complete)) throw new Error('EVIDENCE_NOT_COMPLETE');
  const withMetric = checked.filter(x => x.verification.performanceEligible).map(x => {
    const rows = x.verification.records.filter(official);
    const values = rows.map(r => r.metadata?.featureSnapshot?.momentum);
    const valid = values.length > 0 && values.every(finite);
    return { ...x, rows, valid, mean: valid ? values.reduce((s, v) => s + Math.abs(v), 0) / values.length : null };
  });
  const invalid = withMetric.filter(x => !x.valid).map(({ entry, verification, rows }) => {
    const all = verification.records;
    return {
      cycleId: entry.manifest.cycleId,
      openedAt: entry.manifest.openedAt,
      manifestRecordCount: entry.manifest.recordIds.length,
      officialRecordCount: rows.length,
      statuses: tally(all, r => r.status),
      outcomes: tally(all, r => r.outcome),
      executionStatuses: tally(all, r => r.execution?.status),
      assets: all.map(r => r.asset),
      missingFeatureSnapshot: all.filter(r => !r.metadata?.featureSnapshot).length,
      missingOrNonfiniteMomentum: all.filter(r => !finite(r.metadata?.featureSnapshot?.momentum)).length,
      dataQualityStatuses: tally(all, r => r.metadata?.dataQuality?.status),
      outcomeReasons: tally(all, r => r.outcomeMetadata?.reason),
      providerSources: tally(all, r => r.metadata?.dataQuality?.source),
      quoteAgeRangeMs: range(all.map(r => r.metadata?.dataQuality?.ageMs))
    };
  });
  const accepted = withMetric.filter(x => x.valid && x.mean <= freeze.frozenThreshold);
  const rows = accepted.flatMap(x => x.rows.map(r => ({ ...r, _cycleInventoryCount: x.entry.manifest.recordIds.length })));
  if (rows.length !== formal.analysis.performanceRecords || invalid.length !== formal.analysis.invalidMetricCycles) throw new Error('RESEARCH_COUNTS_MISMATCH');
  const groups = {
    asset: summarize(rows, r => r.asset),
    direction: summarize(rows, r => r.direction),
    utcHour: summarize(rows, r => { const t = Date.parse(r.createdAt ?? r.timestamp ?? ''); return Number.isFinite(t) ? `${String(new Date(t).getUTCHours()).padStart(2, '0')}:00` : 'MISSING'; }),
    assetClass: summarize(rows, r => /^(BTC|ETH|SOL|XRP)\//.test(r.asset ?? '') ? 'CRYPTO' : 'FX'),
    cycleInventorySize: summarize(rows, r => r._cycleInventoryCount),
    absMomentum: summarize(rows, r => bucket(Math.abs(r.metadata?.featureSnapshot?.momentum), [0.25, 0.5, 0.75], ['<0.25', '0.25-<0.50', '0.50-<0.75', '>=0.75'])),
    quoteAgeMs: summarize(rows, r => bucket(r.metadata?.dataQuality?.ageMs, [5001, 15001, 30001], ['<=5000', '5001-15000', '15001-30000', '>30000'])),
    providerSource: summarize(rows, r => r.metadata?.dataQuality?.source),
    regime: summarize(rows, r => r.regime),
    volatility: summarize(rows, r => bucket(r.metadata?.featureSnapshot?.volatility, [0.2, 0.5, 1], ['<0.2', '0.2-<0.5', '0.5-<1', '>=1'])),
    confidence: summarize(rows, r => bucket(r.confidence, [50, 70], ['<50', '50-69', '>=70'])),
    macro: summarize(rows, r => r.metadata?.marketContext?.macro?.status),
    news: summarize(rows, r => r.metadata?.marketContext?.news?.status),
    setup: summarize(rows, r => r.setup)
  };
  return { snapshot: { historySha256: sha256(historyBytes), walSha256: sha256(walBytes), manifestCount: manifests.length },
    formal: formal.analysis, invalid, groups };
}

function tally(rows, key) {
  const out = {};
  for (const row of rows) { const k = clean(key(row)); out[k] = (out[k] ?? 0) + 1; }
  return out;
}
function range(values) {
  const nums = values.filter(finite);
  return nums.length ? [Math.min(...nums), Math.max(...nums)] : null;
}
function bucket(value, cuts, names) {
  if (!finite(value)) return 'MISSING';
  const i = cuts.findIndex(cut => value < cut);
  return names[i < 0 ? names.length - 1 : i];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = argsOf(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(analyze({ historyPath: args['--history'], evidenceDir: args['--evidence-dir'] }), null, 2)}\n`);
}
