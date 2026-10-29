import { createHash } from 'node:crypto';

const ASSET_PATTERN = /^[A-Z0-9][A-Z0-9._:/-]{0,31}$/;
const TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function parseExplicitTimestamp(value) {
  if (typeof value !== 'string' || !TIME_PATTERN.test(value)) return NaN;
  // Reject impossible wall-clock dates instead of trusting Date.parse normalization.
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!match) return NaN;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1] ||
      hour > 23 || minute > 59 || second > 59) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : NaN;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function validateRawBytes(rawBytes) {
  if (!(Buffer.isBuffer(rawBytes) || rawBytes instanceof Uint8Array) || rawBytes.byteLength === 0) {
    throw new Error('RAW_DATASET_BYTES_REQUIRED');
  }
}

function validateMetadata({ datasetId, provider, asset, timeframe, capturedAt, fromTimestamp, toTimestamp, recordCount }) {
  if (typeof datasetId !== 'string' || !datasetId.trim()) throw new Error('DATASET_ID_REQUIRED');
  if (typeof provider !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(provider.trim())) throw new Error('INVALID_PROVIDER_ID');
  const normalizedAsset = typeof asset === 'string' ? asset.trim().toUpperCase() : '';
  if (!ASSET_PATTERN.test(normalizedAsset)) throw new Error('INVALID_DATASET_ASSET');
  if (typeof timeframe !== 'string' || !/^(?:[1-9]\d{0,4}(?:s|sec|m|min|h|hr|d)|tick)$/i.test(timeframe.trim())) {
    throw new Error('INVALID_DATASET_TIMEFRAME');
  }
  const capturedAtMs = parseExplicitTimestamp(capturedAt);
  const fromMs = parseExplicitTimestamp(fromTimestamp);
  const toMs = parseExplicitTimestamp(toTimestamp);
  if (![capturedAtMs, fromMs, toMs].every(Number.isFinite) || fromMs > toMs) {
    throw new Error('INVALID_DATASET_TIME_RANGE');
  }
  if (!Number.isInteger(recordCount) || recordCount < 1) throw new Error('INVALID_DATASET_RECORD_COUNT');
  return {
    schemaVersion: 'will-market-dataset-manifest-v1',
    datasetId: datasetId.trim(),
    provider: provider.trim().toLowerCase(),
    asset: normalizedAsset,
    timeframe: timeframe.trim().toLowerCase(),
    capturedAt: new Date(capturedAtMs).toISOString(),
    fromTimestamp: new Date(fromMs).toISOString(),
    toTimestamp: new Date(toMs).toISOString(),
    recordCount
  };
}

function digestManifest(fields) {
  // The fixed property order is part of the manifest contract.
  return sha256(Buffer.from(JSON.stringify(fields), 'utf8'));
}

/**
 * Creates a content-addressed manifest over the exact raw dataset bytes.
 * It establishes reproducible byte integrity, not the truth or legality of
 * the caller-supplied provider label or historical prices.
 */
export function createMarketDatasetManifest({ rawBytes, ...metadata } = {}) {
  validateRawBytes(rawBytes);
  const fields = validateMetadata(metadata);
  const manifest = {
    ...fields,
    byteLength: rawBytes.byteLength,
    datasetSha256: sha256(rawBytes),
    integrityClaim: 'RAW_BYTES_HASHED_PROVENANCE_NOT_AUTHENTICATED'
  };
  return Object.freeze({ ...manifest, manifestSha256: digestManifest(manifest) });
}

export function verifyMarketDatasetManifest(rawBytes, manifest) {
  try {
    validateRawBytes(rawBytes);
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      return { valid: false, reasonCode: 'INVALID_MANIFEST' };
    }
    const { manifestSha256, ...fields } = manifest;
    if (fields.schemaVersion !== 'will-market-dataset-manifest-v1') {
      return { valid: false, reasonCode: 'UNSUPPORTED_MANIFEST_VERSION' };
    }
    if (fields.byteLength !== rawBytes.byteLength || fields.datasetSha256 !== sha256(rawBytes)) {
      return { valid: false, reasonCode: 'RAW_DATASET_HASH_MISMATCH' };
    }
    if (typeof manifestSha256 !== 'string' || manifestSha256 !== digestManifest(fields)) {
      return { valid: false, reasonCode: 'MANIFEST_HASH_MISMATCH' };
    }
    const { schemaVersion, datasetId, provider, asset, timeframe, capturedAt, fromTimestamp, toTimestamp, recordCount } = fields;
    const normalized = validateMetadata({ datasetId, provider, asset, timeframe, capturedAt, fromTimestamp, toTimestamp, recordCount });
    if (JSON.stringify(normalized) !== JSON.stringify({ schemaVersion, datasetId, provider, asset, timeframe, capturedAt, fromTimestamp, toTimestamp, recordCount })) {
      return { valid: false, reasonCode: 'MANIFEST_METADATA_MISMATCH' };
    }
    if (fields.integrityClaim !== 'RAW_BYTES_HASHED_PROVENANCE_NOT_AUTHENTICATED') {
      return { valid: false, reasonCode: 'INVALID_INTEGRITY_CLAIM' };
    }
    return { valid: true, reasonCode: null, integrityClaim: fields.integrityClaim, datasetSha256: fields.datasetSha256 };
  } catch {
    return { valid: false, reasonCode: 'INVALID_MANIFEST_OR_RAW_DATA' };
  }
}
