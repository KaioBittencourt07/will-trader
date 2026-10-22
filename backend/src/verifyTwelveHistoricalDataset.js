import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { verifyMarketDatasetManifest } from '../../backtest/src/datasetManifest.js';

const DEFAULT_DIRECTORY = path.join(path.resolve(fileURLToPath(new URL('../../', import.meta.url))), 'data', 'market-datasets');
const DATASET_ID_PATTERN = /^twelve-[A-Z0-9._-]+-[a-z0-9._-]+-\d{12}-\d{12}$/;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readJson(filePath) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch {
    return { ok: false, value: null };
  }
}

export function verifyTwelveHistoricalArchive({ datasetId, outputDirectory = DEFAULT_DIRECTORY } = {}) {
  if (typeof datasetId !== 'string' || !DATASET_ID_PATTERN.test(datasetId)) {
    throw new Error('HISTORICAL_DATASET_ID_INVALID');
  }

  const rawPath = path.join(outputDirectory, `${datasetId}.raw.json`);
  const observationsPath = path.join(outputDirectory, `${datasetId}.observations.json`);
  const manifestPath = path.join(outputDirectory, `${datasetId}.manifest.json`);
  const checks = {
    rawFilePresent: fs.existsSync(rawPath),
    observationsFilePresent: fs.existsSync(observationsPath),
    manifestFilePresent: fs.existsSync(manifestPath),
    rawHashValid: false,
    datasetManifestValid: false,
    observationsHashValid: false,
    collectionManifestHashValid: false,
    metadataConsistent: false
  };
  const reasons = [];

  if (!checks.rawFilePresent || !checks.observationsFilePresent || !checks.manifestFilePresent) {
    reasons.push('ARCHIVE_FILE_MISSING');
    return { schemaVersion: 'will-historical-archive-verification-v1', valid: false, datasetId, checks, reasonCodes: reasons };
  }

  const rawBytes = fs.readFileSync(rawPath);
  const observationBytes = fs.readFileSync(observationsPath);
  const manifestResult = readJson(manifestPath);
  const observationsResult = readJson(observationsPath);
  if (!manifestResult.ok || !observationsResult.ok) {
    reasons.push('ARCHIVE_JSON_INVALID');
    return { schemaVersion: 'will-historical-archive-verification-v1', valid: false, datasetId, checks, reasonCodes: reasons };
  }

  const envelope = manifestResult.value;
  const observations = observationsResult.value;
  const manifest = envelope?.datasetManifest;
  if (!envelope || typeof envelope !== 'object' || !manifest || typeof manifest !== 'object') {
    reasons.push('ARCHIVE_MANIFEST_INVALID');
    return { schemaVersion: 'will-historical-archive-verification-v1', valid: false, datasetId, checks, reasonCodes: reasons };
  }

  const rawDigest = sha256(rawBytes);
  checks.rawHashValid = rawDigest === manifest.datasetSha256 && rawBytes.byteLength === manifest.byteLength;
  if (!checks.rawHashValid) reasons.push('RAW_DATASET_HASH_MISMATCH');

  const datasetVerification = verifyMarketDatasetManifest(rawBytes, manifest);
  checks.datasetManifestValid = datasetVerification.valid === true;
  if (!checks.datasetManifestValid) reasons.push(datasetVerification.reasonCode || 'DATASET_MANIFEST_INVALID');

  checks.observationsHashValid = Buffer.isBuffer(observationBytes) &&
    Buffer.byteLength(observationBytes) === Number(envelope.derivedObservations?.byteLength) &&
    sha256(observationBytes) === envelope.derivedObservations?.sha256;
  if (!checks.observationsHashValid) reasons.push('DERIVED_OBSERVATIONS_HASH_MISMATCH');

  const { collectionManifestSha256, ...collectionFields } = envelope;
  checks.collectionManifestHashValid = typeof collectionManifestSha256 === 'string' &&
    sha256(Buffer.from(JSON.stringify(collectionFields), 'utf8')) === collectionManifestSha256;
  if (!checks.collectionManifestHashValid) reasons.push('COLLECTION_MANIFEST_HASH_MISMATCH');

  const rowsArePlausible = Array.isArray(observations) &&
    observations.length === Number(envelope.rowCounts?.closedBars) &&
    observations.every((row) => row && row.asset === manifest.asset &&
      typeof row.timestamp === 'string' && Number.isFinite(Date.parse(row.timestamp)) &&
      Number.isFinite(Number(row.price)) && Number(row.price) > 0 &&
      row.observationSemantics === 'CLOSED_CANDLE_CLOSE_PRICE_AVAILABLE_AT_CLOSE_TIME');
  checks.metadataConsistent = manifest.datasetId === datasetId &&
    envelope.request?.asset === manifest.asset &&
    envelope.request?.interval === manifest.timeframe &&
    Number.isInteger(manifest.recordCount) &&
    manifest.recordCount === Number(envelope.rowCounts?.rawBars) &&
    envelope.integrityClaim === 'RAW_RESPONSE_HASHED_PROVENANCE_NOT_AUTHENTICATED' &&
    rowsArePlausible;
  if (!checks.metadataConsistent) reasons.push('ARCHIVE_METADATA_INCONSISTENT');

  return {
    schemaVersion: 'will-historical-archive-verification-v1',
    valid: reasons.length === 0,
    datasetId,
    verifiedAt: new Date().toISOString(),
    checks,
    reasonCodes: reasons,
    dataTrust: 'BYTE_INTEGRITY_AND_SHAPE_ONLY_SOURCE_AUTHENTICITY_NOT_PROVEN',
    rawSha256: rawDigest,
    observationsSha256: sha256(observationBytes),
    datasetManifestSha256: manifest.manifestSha256,
    collectionManifestSha256: typeof collectionManifestSha256 === 'string' ? collectionManifestSha256 : null,
    rawBarCount: Number(envelope.rowCounts?.rawBars) || 0,
    closedObservationCount: Array.isArray(observations) ? observations.length : 0
  };
}

export function runVerifyHistoricalArchiveCli({
  argv = process.argv.slice(2),
  stdout = (value) => process.stdout.write(value),
  stderr = (value) => process.stderr.write(value),
  outputDirectory = DEFAULT_DIRECTORY
} = {}) {
  let datasetId = null;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      stdout('Uso: npm run market:verify-history -- --dataset-id <ID>\nNão acessa a rede nem requer chave do provedor.\n');
      return 0;
    }
    if (arg !== '--dataset-id' || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      stderr('ARGUMENT_INVALID: use somente --dataset-id <ID>.\n');
      return 2;
    }
    datasetId = argv[++index];
  }
  if (!datasetId) {
    stderr('DATASET_ID_REQUIRED: informe --dataset-id; nenhuma rede será acessada.\n');
    return 2;
  }

  let result;
  try {
    result = verifyTwelveHistoricalArchive({ datasetId, outputDirectory });
  } catch (error) {
    stderr(`ARCHIVE_VERIFY_FAILED:${String(error?.message || 'UNKNOWN').slice(0, 100)}\n`);
    return 2;
  }
  stdout(JSON.stringify(result, null, 2) + '\n');
  return result.valid ? 0 : 1;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = runVerifyHistoricalArchiveCli();
