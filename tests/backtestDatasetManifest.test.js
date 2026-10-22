import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarketDatasetManifest, verifyMarketDatasetManifest } from '../backtest/src/datasetManifest.js';

const metadata = {
  datasetId: 'fixture-eurusd-2026-10-01',
  provider: 'TwelveData',
  asset: 'eur/usd',
  timeframe: '1min',
  capturedAt: '2026-10-01T12:10:00.000Z',
  fromTimestamp: '2026-10-01T12:00:00.000Z',
  toTimestamp: '2026-10-01T12:09:00.000Z',
  recordCount: 10
};

test('market dataset manifest hashes exact raw bytes and verifies reproducibly', () => {
  const rawBytes = Buffer.from('timestamp,asset,price\n2026-10-01T12:00:00.000Z,EUR/USD,1.1\n', 'utf8');
  const manifest = createMarketDatasetManifest({ ...metadata, rawBytes });
  const verification = verifyMarketDatasetManifest(rawBytes, manifest);

  assert.equal(manifest.schemaVersion, 'will-market-dataset-manifest-v1');
  assert.equal(manifest.provider, 'twelvedata');
  assert.equal(manifest.asset, 'EUR/USD');
  assert.equal(manifest.byteLength, rawBytes.byteLength);
  assert.match(manifest.datasetSha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.manifestSha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.integrityClaim, 'RAW_BYTES_HASHED_PROVENANCE_NOT_AUTHENTICATED');
  assert.equal(verification.valid, true);
});

test('manifest verification detects raw byte changes and metadata tampering', () => {
  const rawBytes = Buffer.from('fixture raw bytes v1', 'utf8');
  const manifest = createMarketDatasetManifest({ ...metadata, rawBytes });
  const changedBytes = Buffer.from('fixture raw bytes v2', 'utf8');
  assert.deepEqual(verifyMarketDatasetManifest(changedBytes, manifest), {
    valid: false,
    reasonCode: 'RAW_DATASET_HASH_MISMATCH'
  });

  const tampered = { ...manifest, provider: 'unknown-provider' };
  assert.deepEqual(verifyMarketDatasetManifest(rawBytes, tampered), {
    valid: false,
    reasonCode: 'MANIFEST_HASH_MISMATCH'
  });
});

test('manifest refuses ambiguous dates, unsupported intervals and empty bytes', () => {
  assert.throws(() => createMarketDatasetManifest({
    ...metadata, rawBytes: Buffer.from('x'), capturedAt: '2026-10-01T12:00:00'
  }), /INVALID_DATASET_TIME_RANGE/);
  assert.throws(() => createMarketDatasetManifest({
    ...metadata, rawBytes: Buffer.from('x'), fromTimestamp: '2026-10-02T12:00:00.000Z'
  }), /INVALID_DATASET_TIME_RANGE/);
  assert.throws(() => createMarketDatasetManifest({
    ...metadata, rawBytes: Buffer.from('x'), timeframe: 'one minute'
  }), /INVALID_DATASET_TIMEFRAME/);
  assert.throws(() => createMarketDatasetManifest({ ...metadata, rawBytes: Buffer.alloc(0) }), /RAW_DATASET_BYTES_REQUIRED/);
});
