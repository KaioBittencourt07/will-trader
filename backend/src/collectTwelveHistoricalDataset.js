import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { fetchTwelveHistoricalDataset } from '../../data/src/providers/twelveHistoricalDataset.js';
import { createMarketDatasetManifest } from '../../backtest/src/datasetManifest.js';

const USAGE = `Uso (sem execução de rede até fornecer --confirm-provider-credits):
  cd backend
  node src/collectTwelveHistoricalDataset.js \\
    --asset EUR/USD --interval 1min \\
    --start 2026-10-01T12:00:00Z --end 2026-10-01T13:00:00Z \\
    --confirm-provider-credits

A chave TWELVEDATA_API_KEY deve estar configurada no ambiente ou em backend/.env.
Arquivos são gravados em data/market-datasets/ (ignorado pelo Git).
`;

function parseArgs(argv) {
  const parsed = { confirmProviderCredits: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--confirm-provider-credits') {
      parsed.confirmProviderCredits = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (!['--asset', '--interval', '--start', '--end'].includes(arg)) {
      throw new Error(`ARGUMENT_NOT_SUPPORTED:${String(arg).slice(0, 64)}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`ARGUMENT_VALUE_REQUIRED:${arg}`);
    parsed[arg.slice(2)] = value;
    index++;
  }
  return parsed;
}

function atomicWrite(target, bytes) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx' });
    fs.renameSync(temporary, target);
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch {}
  }
}

export async function collectHistoricalDatasetCli({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
  now = () => Date.now(),
  stdout = (value) => process.stdout.write(value),
  stderr = (value) => process.stderr.write(value),
  outputDirectory: outputDirectoryOverride = null
} = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    stderr(`${error.message}\n${USAGE}`);
    return 2;
  }

  if (options.help) {
    stdout(USAGE);
    return 0;
  }
  if (!options.confirmProviderCredits) {
    stderr('NO_NETWORK_REQUEST_MADE: inclua --confirm-provider-credits para autorizar a consulta histórica.\n');
    stderr(USAGE);
    return 2;
  }

  const repoRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
  const outputDirectory = outputDirectoryOverride ?? path.join(repoRoot, 'data', 'market-datasets');
  const canonicalDatePart = (value) => {
    const parsed = Date.parse(String(value ?? ''));
    return (Number.isFinite(parsed) ? new Date(parsed).toISOString() : String(value ?? ''))
      .replace(/[^0-9]/g, '').slice(0, 12);
  };
  const predictedDatasetId = `twelve-${String(options.asset ?? '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '-')}-${String(options.interval ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-')}-${canonicalDatePart(options.start)}-${canonicalDatePart(options.end)}`;
  const predictedFiles = ['raw.json', 'observations.json', 'manifest.json']
    .map((suffix) => path.join(outputDirectory, `${predictedDatasetId}.${suffix}`));
  if (predictedFiles.some((target) => fs.existsSync(target))) {
    stderr('HISTORICAL_ARTIFACT_ALREADY_EXISTS: refusing to overwrite an archived dataset; no provider request was made.\n');
    return 1;
  }

  let dataset;
  try {
    dataset = await fetchTwelveHistoricalDataset({
      apiKey: env.TWELVEDATA_API_KEY,
      asset: options.asset,
      interval: options.interval,
      startDate: options.start,
      endDate: options.end,
      fetchImpl,
      now
    });
  } catch (error) {
    const status = Number(error?.status);
    const retry = Number(error?.retryAfterMs);
    const details = [
      Number.isInteger(status) ? `httpStatus=${status}` : null,
      Number.isFinite(retry) && retry >= 0 ? `retryAfterMs=${retry}` : null
    ].filter(Boolean).join(' ');
    stderr(`HISTORICAL_INGEST_FAILED ${String(error?.message || 'UNKNOWN').slice(0, 160)} ${details}\n`);
    return 1;
  }

  const safeAsset = dataset.asset.replace(/[^A-Z0-9._-]/g, '-');
  const safeInterval = dataset.interval.replace(/[^a-z0-9._-]/g, '-');
  const fromPart = dataset.requestedWindow.start.replace(/[^0-9]/g, '').slice(0, 12);
  const toPart = dataset.requestedWindow.end.replace(/[^0-9]/g, '').slice(0, 12);
  const datasetId = `twelve-${safeAsset}-${safeInterval}-${fromPart}-${toPart}`;
  if (datasetId !== predictedDatasetId) {
    stderr('HISTORICAL_DATASET_ID_MISMATCH: refusing to archive ambiguous output.\n');
    return 1;
  }
  const rawFile = `${datasetId}.raw.json`;
  const observationsFile = `${datasetId}.observations.json`;
  const manifestFile = `${datasetId}.manifest.json`;
  const artifactPaths = [path.join(outputDirectory, rawFile), path.join(outputDirectory, observationsFile), path.join(outputDirectory, manifestFile)];
  if (artifactPaths.some((target) => fs.existsSync(target))) {
    stderr('HISTORICAL_ARTIFACT_ALREADY_EXISTS: refusing to overwrite an archived dataset.\n');
    return 1;
  }

  const rawBytes = Buffer.from(dataset.rawDataset.bytes);
  const observationBytes = Buffer.from(JSON.stringify(dataset.observations, null, 2), 'utf8');
  const manifest = createMarketDatasetManifest({
    rawBytes,
    datasetId,
    provider: 'twelvedata',
    asset: dataset.asset,
    timeframe: dataset.interval,
    capturedAt: dataset.retrievedAt,
    fromTimestamp: dataset.bars[0].barOpenTimestamp,
    toTimestamp: dataset.bars.at(-1).barOpenTimestamp,
    recordCount: dataset.rowCounts.rawBars
  });
  const collectionFields = {
    schemaVersion: 'will-historical-collection-manifest-v1',
    datasetManifest: manifest,
    request: {
      asset: dataset.asset,
      interval: dataset.interval,
      start: dataset.requestedWindow.start,
      end: dataset.requestedWindow.end
    },
    rowCounts: dataset.rowCounts,
    requestBudget: dataset.requestBudget,
    integrityClaim: dataset.integrityClaim,
    derivedObservations: {
      file: observationsFile,
      byteLength: observationBytes.byteLength,
      sha256: createHash('sha256').update(observationBytes).digest('hex')
    }
  };
  const collectionManifestSha256 = createHash('sha256').update(Buffer.from(JSON.stringify(collectionFields), 'utf8')).digest('hex');
  const collectionManifest = { ...collectionFields, collectionManifestSha256 };

  try {
    atomicWrite(path.join(outputDirectory, rawFile), rawBytes);
    atomicWrite(path.join(outputDirectory, observationsFile), observationBytes);
    atomicWrite(path.join(outputDirectory, manifestFile), Buffer.from(JSON.stringify(collectionManifest, null, 2), 'utf8'));
  } catch (error) {
    stderr(`HISTORICAL_ARTIFACT_WRITE_FAILED:${String(error?.code || 'IO_ERROR').slice(0, 80)}\n`);
    return 1;
  }

  stdout(JSON.stringify({
    status: 'HISTORICAL_DATASET_SAVED',
    datasetId,
    asset: dataset.asset,
    interval: dataset.interval,
    rowCounts: dataset.rowCounts,
    rawSha256: dataset.rawDataset.sha256,
    manifestSha256: manifest.manifestSha256,
    collectionManifestSha256,
    providerReportedCreditsUsed: dataset.requestBudget.providerReportedCreditsUsed,
    providerReportedCreditsLeft: dataset.requestBudget.providerReportedCreditsLeft,
    rawFile: `${datasetId}.raw.json`,
    observationsFile: `${datasetId}.observations.json`,
    manifestFile: `${datasetId}.manifest.json`,
    edgeProven: false,
    note: 'Dataset is archived, not yet a trading-result claim.'
  }, null, 2) + '\n');
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  collectHistoricalDatasetCli().then((code) => { process.exitCode = code; }).catch(() => {
    process.stderr.write('HISTORICAL_INGEST_UNEXPECTED_FAILURE\n');
    process.exitCode = 1;
  });
}
