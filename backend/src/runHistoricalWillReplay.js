import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { runWillStrategyReplay } from '../../backtest/src/willStrategyReplay.js';
import { verifyTwelveHistoricalArchive } from './verifyTwelveHistoricalDataset.js';

const DEFAULT_DIRECTORY = path.join(path.resolve(fileURLToPath(new URL('../../', import.meta.url))), 'data', 'market-datasets');
const DATASET_ID_PATTERN = /^twelve-[A-Z0-9._-]+-[a-z0-9._-]+-\d{12}-\d{12}$/;
const INTERVAL_MS = Object.freeze({
  '1min': 60_000,
  '5min': 5 * 60_000,
  '15min': 15 * 60_000,
  '30min': 30 * 60_000,
  '45min': 45 * 60_000,
  '1h': 60 * 60_000,
  '2h': 2 * 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '8h': 8 * 60 * 60_000
});
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error('HISTORICAL_ARCHIVE_JSON_INVALID');
  }
}

function parseExplicitTimestamp(value) {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : NaN;
}

function parseProviderBarTime(value) {
  if (typeof value !== 'string' || !value.trim()) return NaN;
  const trimmed = value.trim();
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/i.test(trimmed)
    ? trimmed
    : `${trimmed.replace(' ', 'T')}Z`;
  const result = Date.parse(normalized);
  return Number.isFinite(result) ? result : NaN;
}

function positivePrice(value) {
  const result = Number(value);
  return Number.isFinite(result) && result > 0 ? result : NaN;
}

function verifyAndBuildBars({ datasetId, outputDirectory }) {
  const verification = verifyTwelveHistoricalArchive({ datasetId, outputDirectory });
  if (!verification.valid) throw new Error(`HISTORICAL_ARCHIVE_INTEGRITY_FAILED:${verification.reasonCodes.join(',')}`);

  const rawBytes = fs.readFileSync(path.join(outputDirectory, `${datasetId}.raw.json`));
  const observationsBytes = fs.readFileSync(path.join(outputDirectory, `${datasetId}.observations.json`));
  const envelope = readJson(path.join(outputDirectory, `${datasetId}.manifest.json`));
  const payload = readJson(path.join(outputDirectory, `${datasetId}.raw.json`));
  const savedObservations = JSON.parse(observationsBytes.toString('utf8'));
  const datasetManifest = envelope?.datasetManifest;

  if (!datasetManifest || payload?.status === 'error' || !Array.isArray(payload?.values)) {
    throw new Error('HISTORICAL_ARCHIVE_PROVIDER_PAYLOAD_INVALID');
  }
  if (!DATASET_ID_PATTERN.test(datasetId) || datasetManifest.datasetId !== datasetId) {
    throw new Error('HISTORICAL_ARCHIVE_DATASET_ID_MISMATCH');
  }

  const asset = String(datasetManifest.asset ?? '').trim().toUpperCase();
  const interval = String(datasetManifest.timeframe ?? '').trim().toLowerCase();
  const barWidthMs = INTERVAL_MS[interval];
  const startMs = parseExplicitTimestamp(envelope.request?.start);
  const endMs = parseExplicitTimestamp(envelope.request?.end);
  const asOfMs = parseExplicitTimestamp(datasetManifest.capturedAt);
  if (!barWidthMs || !Number.isFinite(startMs) || !Number.isFinite(endMs) ||
      !Number.isFinite(asOfMs) || startMs >= endMs || endMs > asOfMs) {
    throw new Error('HISTORICAL_ARCHIVE_TIME_CONTRACT_INVALID');
  }
  if (payload.values.length !== Number(datasetManifest.recordCount) ||
      payload.values.length !== Number(envelope.rowCounts?.rawBars)) {
    throw new Error('HISTORICAL_ARCHIVE_RAW_ROW_COUNT_MISMATCH');
  }

  const seen = new Set();
  const bars = payload.values.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`HISTORICAL_ARCHIVE_BAR_INVALID:${index}`);
    }
    const openMs = parseProviderBarTime(row.datetime);
    if (!Number.isFinite(openMs) || openMs < startMs || openMs >= endMs) {
      throw new Error(`HISTORICAL_ARCHIVE_BAR_OUTSIDE_WINDOW:${index}`);
    }
    if (seen.has(openMs)) throw new Error('HISTORICAL_ARCHIVE_DUPLICATE_BAR');
    seen.add(openMs);

    const open = positivePrice(row.open);
    const high = positivePrice(row.high);
    const low = positivePrice(row.low);
    const close = positivePrice(row.close);
    if (![open, high, low, close].every(Number.isFinite) ||
        high < Math.max(open, close, low) || low > Math.min(open, close, high)) {
      throw new Error(`HISTORICAL_ARCHIVE_OHLC_INVALID:${index}`);
    }
    return {
      barOpenTimestamp: new Date(openMs).toISOString(),
      barCloseTimestamp: new Date(openMs + barWidthMs).toISOString(),
      open, high, low, close
    };
  }).sort((a, b) => Date.parse(a.barOpenTimestamp) - Date.parse(b.barOpenTimestamp));

  const closedBars = bars.filter((bar) => Date.parse(bar.barCloseTimestamp) <= asOfMs);
  if (closedBars.length !== Number(envelope.rowCounts?.closedBars) ||
      savedObservations.length !== closedBars.length) {
    throw new Error('HISTORICAL_ARCHIVE_CLOSED_BAR_COUNT_MISMATCH');
  }

  for (let index = 0; index < closedBars.length; index++) {
    const bar = closedBars[index];
    const observation = savedObservations[index];
    if (!observation ||
        observation.asset !== asset ||
        observation.timestamp !== bar.barCloseTimestamp ||
        Number(observation.price) !== bar.close ||
        observation.barOpenTimestamp !== bar.barOpenTimestamp ||
        observation.barCloseTimestamp !== bar.barCloseTimestamp) {
      throw new Error(`HISTORICAL_ARCHIVE_DERIVED_OBSERVATION_MISMATCH:${index}`);
    }
  }

  return {
    bars: closedBars,
    asset,
    interval,
    asOfTimestamp: new Date(asOfMs).toISOString(),
    rawSha256: verification.rawSha256,
    observationsSha256: verification.observationsSha256,
    datasetManifestSha256: verification.datasetManifestSha256,
    collectionManifestSha256: verification.collectionManifestSha256,
    datasetManifest
  };
}

function parseArgs(argv) {
  const options = {
    datasetId: null,
    payoutRatio: null,
    stake: 1,
    costPerTrade: 0,
    expirySeconds: 60,
    minimumBinaryTrades: 100,
    minimumConfidence: 70,
    entryWindowStartSeconds: 60,
    entryWindowEndSeconds: 300,
    entryDelaySeconds: 120,
    maxEntryQuoteDelayMs: 5_000,
    maxExpiryQuoteDelayMs: 5_000
  };
  const numeric = new Set([
    '--payout-ratio', '--stake', '--cost-per-trade', '--expiry-seconds',
    '--minimum-binary-trades', '--minimum-confidence',
    '--entry-window-start-seconds', '--entry-window-end-seconds',
    '--entry-delay-seconds', '--max-entry-quote-delay-ms', '--max-expiry-quote-delay-ms'
  ]);
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { ...options, help: true };
    if (arg !== '--dataset-id' && !numeric.has(arg)) throw new Error('ARGUMENT_NOT_SUPPORTED');
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`ARGUMENT_VALUE_REQUIRED:${arg}`);
    index++;
    if (arg === '--dataset-id') {
      options.datasetId = value;
      continue;
    }
    const key = ({
      '--payout-ratio': 'payoutRatio',
      '--stake': 'stake',
      '--cost-per-trade': 'costPerTrade',
      '--expiry-seconds': 'expirySeconds',
      '--minimum-binary-trades': 'minimumBinaryTrades',
      '--minimum-confidence': 'minimumConfidence',
      '--entry-window-start-seconds': 'entryWindowStartSeconds',
      '--entry-window-end-seconds': 'entryWindowEndSeconds',
      '--entry-delay-seconds': 'entryDelaySeconds',
      '--max-entry-quote-delay-ms': 'maxEntryQuoteDelayMs',
      '--max-expiry-quote-delay-ms': 'maxExpiryQuoteDelayMs'
    })[arg];
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`ARGUMENT_NUMBER_INVALID:${arg}`);
    options[key] = parsed;
  }
  if (!options.datasetId || !DATASET_ID_PATTERN.test(options.datasetId)) {
    throw new Error('HISTORICAL_DATASET_ID_REQUIRED');
  }
  return options;
}

function atomicWrite(filePath, bytes) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx' });
    fs.renameSync(temporary, filePath);
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch {}
  }
}

/**
 * Runs the actual deterministic WILL pipeline over an already archived dataset.
 * This command does not access the network, provider credentials, history store,
 * live scanner, advisor APIs, broker or real-money execution.
 */
export function verifyHistoricalWillReplayArtifact({ datasetId, outputDirectory = DEFAULT_DIRECTORY } = {}) {
  if (typeof datasetId !== 'string' || !DATASET_ID_PATTERN.test(datasetId)) {
    throw new Error('HISTORICAL_DATASET_ID_REQUIRED');
  }

  const archive = verifyTwelveHistoricalArchive({ datasetId, outputDirectory });
  const reportPath = path.join(outputDirectory, `${datasetId}.will-replay-v1.json`);
  const manifestPath = path.join(outputDirectory, `${datasetId}.will-replay-v1.manifest.json`);
  const checks = {
    sourceArchiveValid: archive.valid === true,
    replayReportPresent: fs.existsSync(reportPath),
    replayManifestPresent: fs.existsSync(manifestPath),
    reportSha256Valid: false,
    manifestSha256Valid: false,
    sourceHashesMatch: false,
    reportContractValid: false
  };
  const reasonCodes = [];
  if (!checks.replayReportPresent || !checks.replayManifestPresent) {
    reasonCodes.push('REPLAY_ARTIFACT_MISSING');
    return { schemaVersion: 'will-historical-replay-verification-v1', valid: false, datasetId, checks, reasonCodes };
  }

  const reportBytes = fs.readFileSync(reportPath);
  const report = (() => {
    try { return JSON.parse(reportBytes.toString('utf8')); } catch { return null; }
  })();
  const manifest = readJson(manifestPath);
  if (!report || !manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    reasonCodes.push('REPLAY_ARTIFACT_JSON_INVALID');
    return { schemaVersion: 'will-historical-replay-verification-v1', valid: false, datasetId, checks, reasonCodes };
  }

  checks.reportSha256Valid = hash(reportBytes) === manifest.reportSha256;
  if (!checks.reportSha256Valid) reasonCodes.push('REPLAY_REPORT_HASH_MISMATCH');

  const { replayManifestSha256, ...manifestFields } = manifest;
  checks.manifestSha256Valid = typeof replayManifestSha256 === 'string' &&
    hash(Buffer.from(JSON.stringify(manifestFields), 'utf8')) === replayManifestSha256;
  if (!checks.manifestSha256Valid) reasonCodes.push('REPLAY_MANIFEST_HASH_MISMATCH');

  checks.sourceHashesMatch = checks.sourceArchiveValid &&
    manifest.datasetId === datasetId &&
    manifest.datasetRawSha256 === archive.rawSha256 &&
    manifest.datasetObservationsSha256 === archive.observationsSha256 &&
    manifest.datasetManifestSha256 === archive.datasetManifestSha256 &&
    manifest.collectionManifestSha256 === archive.collectionManifestSha256;
  if (!checks.sourceHashesMatch) reasonCodes.push('REPLAY_SOURCE_HASH_MISMATCH');

  checks.reportContractValid = report.schemaVersion === 'will-strategy-historical-replay-v1' &&
    report.mode === 'WILL_STRATEGY_HISTORICAL_OHLC_REPLAY' &&
    report.edgeProven === false &&
    report.datasetEvidence?.datasetManifest?.datasetId === datasetId &&
    Array.isArray(report.decisions) &&
    Array.isArray(report.results) &&
    report.decisions.length === report.decisionBars &&
    report.results.length === report.decisionBars &&
    manifest.replayMode === report.mode &&
    manifest.edgeProven === false;
  if (!checks.reportContractValid) reasonCodes.push('REPLAY_REPORT_CONTRACT_INVALID');

  return {
    schemaVersion: 'will-historical-replay-verification-v1',
    valid: reasonCodes.length === 0,
    datasetId,
    checks,
    reasonCodes,
    reportSha256: hash(reportBytes),
    replayManifestSha256,
    sourceTrust: 'ARCHIVE_HASH_CHAIN_VERIFIED_SOURCE_AUTHENTICITY_AND_MARKET_EDGE_NOT_PROVEN',
    summary: {
      asset: report.asset ?? null,
      interval: report.interval ?? null,
      barsAvailable: report.barsAvailable ?? null,
      decisionBars: report.decisionBars ?? null,
      settledTrades: report.settledTrades ?? null,
      unresolvedTrades: report.unresolvedTrades ?? null,
      edgeProven: false
    }
  };
}

export function runHistoricalWillReplayCli({
  argv = process.argv.slice(2),
  stdout = (value) => process.stdout.write(value),
  stderr = (value) => process.stderr.write(value),
  outputDirectory = DEFAULT_DIRECTORY,
  now = () => Date.now()
} = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    stderr(`HISTORICAL_REPLAY_ARGUMENT_ERROR:${String(error?.message || 'INVALID_ARGUMENT').slice(0, 100)}\n`);
    return 2;
  }
  if (options.help) {
    stdout('Uso: npm run market:replay -- --dataset-id <ID> [--payout-ratio 0.8 --stake 1 --cost-per-trade 0]\nNão acessa rede; arquivos devem existir em data/market-datasets/.\n');
    return 0;
  }

  const outputPath = path.join(outputDirectory, `${options.datasetId}.will-replay-v1.json`);
  const manifestPath = path.join(outputDirectory, `${options.datasetId}.will-replay-v1.manifest.json`);
  if (fs.existsSync(outputPath) || fs.existsSync(manifestPath)) {
    stderr('HISTORICAL_REPLAY_ARTIFACT_EXISTS: refusing to overwrite an earlier report.\n');
    return 1;
  }

  let source;
  let report;
  try {
    source = verifyAndBuildBars({ datasetId: options.datasetId, outputDirectory });
    report = runWillStrategyReplay({
      bars: source.bars,
      asset: source.asset,
      interval: source.interval,
      asOfTimestamp: source.asOfTimestamp,
      datasetManifest: {
        schemaVersion: source.datasetManifest.schemaVersion,
        datasetId: source.datasetManifest.datasetId,
        datasetSha256: source.datasetManifest.datasetSha256,
        manifestSha256: source.datasetManifest.manifestSha256,
        capturedAt: source.datasetManifest.capturedAt
      },
      strategyOptions: {
        minimumConfidence: options.minimumConfidence,
        entryWindowStartSeconds: options.entryWindowStartSeconds,
        entryWindowEndSeconds: options.entryWindowEndSeconds,
        entryDelaySeconds: options.entryDelaySeconds,
        expirySeconds: options.expirySeconds
      },
      replayOptions: {
        payoutRatio: options.payoutRatio,
        stake: options.stake,
        costPerTrade: options.costPerTrade,
        expirySeconds: options.expirySeconds,
        minimumBinaryTrades: options.minimumBinaryTrades,
        maxEntryQuoteDelayMs: options.maxEntryQuoteDelayMs,
        maxExpiryQuoteDelayMs: options.maxExpiryQuoteDelayMs
      }
    });
  } catch (error) {
    stderr(`HISTORICAL_REPLAY_FAILED:${String(error?.message || 'UNKNOWN').slice(0, 180)}\n`);
    return 1;
  }

  const reportBytes = Buffer.from(JSON.stringify(report, null, 2), 'utf8');
  const reportSha256 = hash(reportBytes);
  const manifestFields = {
    schemaVersion: 'will-historical-strategy-replay-manifest-v1',
    datasetId: options.datasetId,
    reportFile: path.basename(outputPath),
    reportSha256,
    datasetRawSha256: source.rawSha256,
    datasetObservationsSha256: source.observationsSha256,
    datasetManifestSha256: source.datasetManifestSha256,
    collectionManifestSha256: source.collectionManifestSha256,
    replayOptions: options,
    replayMode: 'WILL_STRATEGY_HISTORICAL_OHLC_REPLAY',
    edgeProven: false,
    sourceAuthenticity: 'NOT_AUTHENTICATED',
    createdAt: new Date(now()).toISOString()
  };
  const manifestBytes = Buffer.from(JSON.stringify({
    ...manifestFields,
    replayManifestSha256: hash(Buffer.from(JSON.stringify(manifestFields), 'utf8'))
  }, null, 2), 'utf8');

  try {
    // Refuse overwrite twice: once before compute and once immediately before writes.
    if (fs.existsSync(outputPath) || fs.existsSync(manifestPath)) {
      stderr('HISTORICAL_REPLAY_ARTIFACT_EXISTS: refusing to overwrite an earlier report.\n');
      return 1;
    }
    atomicWrite(outputPath, reportBytes);
    atomicWrite(manifestPath, manifestBytes);
  } catch (error) {
    stderr(`HISTORICAL_REPLAY_WRITE_FAILED:${String(error?.code || 'IO_ERROR').slice(0, 80)}\n`);
    return 1;
  }

  stdout(JSON.stringify({
    status: 'HISTORICAL_WILL_REPLAY_SAVED',
    datasetId: options.datasetId,
    asset: source.asset,
    interval: source.interval,
    barsUsed: source.bars.length,
    decisions: report.decisionCount,
    wins: report.wins,
    losses: report.losses,
    ties: report.ties,
    waitCount: report.waitCount,
    blockedCount: report.blockedCount,
    unresolvedTrades: report.unresolvedTrades,
    binaryWinRate: report.binaryWinRate,
    payoutRatio: report.payoutRatio,
    netPnl: report.netPnl,
    edgeProven: false,
    reportFile: path.basename(outputPath),
    reportSha256,
    reportManifest: path.basename(manifestPath),
    note: 'Historical replay result only; not paper-forward validation or proof of financial edge.'
  }, null, 2) + '\n');
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = runHistoricalWillReplayCli();
