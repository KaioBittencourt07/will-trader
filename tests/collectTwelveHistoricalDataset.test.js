import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { collectHistoricalDatasetCli } from '../backend/src/collectTwelveHistoricalDataset.js';
import { verifyMarketDatasetManifest } from '../backtest/src/datasetManifest.js';

const startMs = Date.parse('2026-10-01T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const key = 'synthetic-test-api-key-123456789';

function providerResponse() {
  const rawBytes = Buffer.from(JSON.stringify({
    meta: { symbol: 'EUR/USD', interval: '1min' },
    values: [
      { datetime: '2026-10-01 12:01:00', open: '1.1', high: '1.12', low: '1.09', close: '1.11' },
      { datetime: '2026-10-01 12:00:00', open: '1.0', high: '1.02', low: '0.99', close: '1.01' }
    ]
  }), 'utf8');
  return {
    rawBytes,
    response: {
      ok: true,
      status: 200,
      headers: { get: (name) => name.toLowerCase() === 'api-credits-used' ? '1' : null },
      async arrayBuffer() { return rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength); }
    }
  };
}

test('CLI does not access network or write files until provider-credit confirmation is explicit', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'will-market-ingest-no-consent-'));
  let requests = 0;
  let output = '';
  let errorOutput = '';
  try {
    const code = await collectHistoricalDatasetCli({
      argv: ['--asset', 'EUR/USD', '--interval', '1min', '--start', iso(startMs), '--end', iso(startMs + 120_000)],
      env: { TWELVEDATA_API_KEY: key },
      fetchImpl: async () => { requests++; throw new Error('MUST_NOT_CALL'); },
      outputDirectory: directory,
      stdout: (value) => { output += value; },
      stderr: (value) => { errorOutput += value; }
    });
    assert.equal(code, 2);
    assert.equal(requests, 0);
    assert.equal(fs.readdirSync(directory).length, 0);
    assert.match(errorOutput, /NO_NETWORK_REQUEST_MADE/);
    assert.equal(output, '');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI archives original raw bytes, closed observations and independently verifiable manifest', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'will-market-ingest-success-'));
  let requestUrl = '';
  let requestHeaders;
  let output = '';
  let fetchCalls = 0;
  try {
    const canned = providerResponse();
    const code = await collectHistoricalDatasetCli({
      argv: [
        '--asset', 'EUR/USD',
        '--interval', '1min',
        '--start', iso(startMs),
        '--end', iso(startMs + 120_000),
        '--confirm-provider-credits'
      ],
      env: { TWELVEDATA_API_KEY: key },
      fetchImpl: async (url, options) => { fetchCalls++; requestUrl = url; requestHeaders = options.headers; return canned.response; },
      now: () => startMs + 180_000,
      outputDirectory: directory,
      stdout: (value) => { output += value; },
      stderr: (value) => { throw new Error(value); }
    });
    assert.equal(code, 0);
    assert.doesNotMatch(requestUrl, /apikey|synthetic-test-api-key/);
    assert.equal(requestHeaders.Authorization, `apikey ${key}`);
    const files = fs.readdirSync(directory);
    assert.equal(files.length, 3);
    const rawFile = files.find((name) => name.endsWith('.raw.json'));
    const observationsFile = files.find((name) => name.endsWith('.observations.json'));
    const manifestFile = files.find((name) => name.endsWith('.manifest.json'));
    assert.ok(rawFile && observationsFile && manifestFile);
    const storedRaw = fs.readFileSync(path.join(directory, rawFile));
    assert.deepEqual(storedRaw, canned.rawBytes);
    assert.equal(createHash('sha256').update(storedRaw).digest('hex'), JSON.parse(output).rawSha256);
    const savedManifest = JSON.parse(fs.readFileSync(path.join(directory, manifestFile), 'utf8'));
    assert.equal(verifyMarketDatasetManifest(storedRaw, savedManifest.datasetManifest).valid, true);
    const { collectionManifestSha256, ...collectionFields } = savedManifest;
    assert.equal(
      createHash('sha256').update(Buffer.from(JSON.stringify(collectionFields), 'utf8')).digest('hex'),
      collectionManifestSha256
    );
    const observationsBytes = fs.readFileSync(path.join(directory, observationsFile));
    assert.equal(
      createHash('sha256').update(observationsBytes).digest('hex'),
      savedManifest.derivedObservations.sha256
    );
    const observations = JSON.parse(observationsBytes.toString('utf8'));
    assert.deepEqual(observations.map((row) => row.timestamp), [iso(startMs + 60_000), iso(startMs + 120_000)]);
    const summary = JSON.parse(output);
    assert.equal(summary.edgeProven, false);
    assert.equal(summary.providerReportedCreditsUsed, 1);
    assert.equal(summary.note, 'Dataset is archived, not yet a trading-result claim.');

    let duplicateError = '';
    const duplicateCode = await collectHistoricalDatasetCli({
      argv: [
        '--asset', 'EUR/USD', '--interval', '1min',
        '--start', iso(startMs), '--end', iso(startMs + 120_000),
        '--confirm-provider-credits'
      ],
      env: { TWELVEDATA_API_KEY: key },
      fetchImpl: async () => { fetchCalls++; return canned.response; },
      outputDirectory: directory,
      stdout: () => {},
      stderr: (value) => { duplicateError += value; }
    });
    assert.equal(duplicateCode, 1);
    assert.equal(fetchCalls, 1);
    assert.match(duplicateError, /no provider request was made/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI returns safe errors for provider rejection and cannot print credential values', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'will-market-ingest-error-'));
  let stderr = '';
  try {
    const code = await collectHistoricalDatasetCli({
      argv: [
        '--asset', 'EUR/USD', '--interval', '1min',
        '--start', iso(startMs), '--end', iso(startMs + 60_000),
        '--confirm-provider-credits'
      ],
      env: { TWELVEDATA_API_KEY: key },
      fetchImpl: async () => ({
        ok: false,
        status: 429,
        headers: { get: (name) => name.toLowerCase() === 'retry-after' ? '30' : null }
      }),
      outputDirectory: directory,
      stdout: () => {},
      stderr: (value) => { stderr += value; }
    });
    assert.equal(code, 1);
    assert.match(stderr, /TWELVEDATA_HISTORICAL_HTTP_429/);
    assert.match(stderr, /retryAfterMs=30000/);
    assert.equal(stderr.includes(key), false);
    assert.equal(fs.readdirSync(directory).length, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
