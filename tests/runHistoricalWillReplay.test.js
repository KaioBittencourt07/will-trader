import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { collectHistoricalDatasetCli } from '../backend/src/collectTwelveHistoricalDataset.js';
import { runHistoricalWillReplayCli } from '../backend/src/runHistoricalWillReplay.js';
import { verifyHistoricalWillReplayArtifact } from '../backend/src/runHistoricalWillReplay.js';

const startMs = Date.parse('2026-10-01T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const key = 'synthetic-test-api-key-123456789';

function makeProviderResponse() {
  const values = [];
  let previousClose = 100;
  for (let index = 0; index < 80; index++) {
    const openMs = startMs + index * 60_000;
    const open = previousClose;
    const close = 100 + index * 0.08 + Math.sin(index / 3) * 0.025;
    const high = Math.max(open, close) + 0.04;
    const low = Math.min(open, close) - 0.04;
    values.push({
      datetime: iso(openMs).replace('T', ' ').replace('Z', ''),
      open: String(open),
      high: String(high),
      low: String(low),
      close: String(close)
    });
    previousClose = close;
  }
  const rawBytes = Buffer.from(JSON.stringify({
    meta: { symbol: 'EUR/USD', interval: '1min', timezone: 'UTC' },
    values
  }), 'utf8');
  return {
    rawBytes,
    response: {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          if (name.toLowerCase() === 'content-type') return 'application/json';
          if (name.toLowerCase() === 'api-credits-used') return '1';
          return null;
        }
      },
      async arrayBuffer() { return rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength); }
    }
  };
}

async function collectDataset(directory) {
  const fixture = makeProviderResponse();
  let stdout = '';
  let stderr = '';
  const exitCode = await collectHistoricalDatasetCli({
    argv: [
      '--asset', 'EUR/USD',
      '--interval', '1min',
      '--start', iso(startMs),
      '--end', iso(startMs + 80 * 60_000),
      '--confirm-provider-credits'
    ],
    env: { TWELVEDATA_API_KEY: key },
    fetchImpl: async () => fixture.response,
    now: () => startMs + 81 * 60_000,
    outputDirectory: directory,
    stdout: (value) => { stdout += value; },
    stderr: (value) => { stderr += value; }
  });
  assert.equal(exitCode, 0, stderr);
  return { summary: JSON.parse(stdout), rawBytes: fixture.rawBytes };
}

test('offline replay CLI runs the real WILL pipeline from a verified historical archive', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'will-full-market-replay-'));
  try {
    const { summary: dataset } = await collectDataset(directory);
    let replayStdout = '';
    let replayStderr = '';
    const replayExit = runHistoricalWillReplayCli({
      argv: [
        '--dataset-id', dataset.datasetId,
        '--payout-ratio', '0.8',
        '--stake', '1',
        '--cost-per-trade', '0.01',
        '--minimum-binary-trades', '1',
        '--minimum-confidence', '1'
      ],
      outputDirectory: directory,
      now: () => startMs + 82 * 60_000,
      stdout: (value) => { replayStdout += value; },
      stderr: (value) => { replayStderr += value; }
    });
    assert.equal(replayExit, 0, replayStderr);

    const replaySummary = JSON.parse(replayStdout);
    assert.equal(replaySummary.status, 'HISTORICAL_WILL_REPLAY_SAVED');
    assert.equal(replaySummary.datasetId, dataset.datasetId);
    assert.equal(replaySummary.barsUsed, 80);
    assert.equal(replaySummary.decisions, 69);
    assert.equal(replaySummary.edgeProven, false);

    const reportBytes = fs.readFileSync(path.join(directory, replaySummary.reportFile));
    assert.equal(createHash('sha256').update(reportBytes).digest('hex'), replaySummary.reportSha256);
    const report = JSON.parse(reportBytes.toString('utf8'));
    assert.equal(report.strategy.source, 'ACTUAL_WILL_PIPELINE');
    assert.equal(report.edgeProven, false);
    assert.equal(report.decisions.length, 69);
    assert.ok(report.decisions.every((decision) => decision.decisionCandleCloseTimestamp <= report.asOfTimestamp));
    assert.ok(report.results.every((result) => result.decision !== null));

    const verification = verifyHistoricalWillReplayArtifact({ datasetId: dataset.datasetId, outputDirectory: directory });
    assert.equal(verification.valid, true);
    assert.equal(verification.checks.sourceArchiveValid, true);
    assert.equal(verification.checks.reportSha256Valid, true);
    assert.equal(verification.checks.manifestSha256Valid, true);
    assert.equal(verification.checks.sourceHashesMatch, true);
    assert.equal(verification.checks.reportContractValid, true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('replay CLI refuses invalid archives and never overwrites an existing report', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'will-replay-no-overwrite-'));
  try {
    const { summary: dataset } = await collectDataset(directory);
    const replayArgs = [
      '--dataset-id', dataset.datasetId,
      '--payout-ratio', '0.8',
      '--minimum-binary-trades', '1',
      '--minimum-confidence', '1'
    ];

    const first = runHistoricalWillReplayCli({
      argv: replayArgs, outputDirectory: directory,
      now: () => startMs + 82 * 60_000,
      stdout: () => {}, stderr: (value) => { throw new Error(value); }
    });
    assert.equal(first, 0);

    let errorOutput = '';
    const second = runHistoricalWillReplayCli({
      argv: replayArgs,
      outputDirectory: directory,
      stdout: () => {},
      stderr: (value) => { errorOutput += value; }
    });
    assert.equal(second, 1);
    assert.match(errorOutput, /refusing to overwrite/);

    const manifestPath = path.join(directory, `${dataset.datasetId}.manifest.json`);
    const envelope = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    fs.writeFileSync(manifestPath, JSON.stringify({ ...envelope, rowCounts: { ...envelope.rowCounts, closedBars: 2 } }, null, 2));

    errorOutput = '';
    const third = runHistoricalWillReplayCli({
      argv: ['--dataset-id', dataset.datasetId],
      outputDirectory: directory,
      stdout: () => {},
      stderr: (value) => { errorOutput += value; }
    });
    assert.equal(third, 1);
    assert.match(errorOutput, /HISTORICAL_ARCHIVE_INTEGRITY_FAILED/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
