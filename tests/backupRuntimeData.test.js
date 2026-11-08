import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { backupRuntimeData } from '../scripts/backup-runtime-data.mjs';

test('runtime data backup copies every file and verifies SHA-256 without changing source', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'will-runtime-backup-'));
  const sourceDir = path.join(root, 'repo', 'backend', 'data');
  const destinationRoot = path.join(root, 'backups');
  fs.mkdirSync(path.join(sourceDir, 'commissioning-canary'), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'will-history.json'), JSON.stringify([{ id: 'history-1' }]));
  fs.writeFileSync(path.join(sourceDir, 'commissioning-canary', 'state.json'), JSON.stringify({ status: 'preserve' }));

  try {
    const result = await backupRuntimeData({
      sourceDir,
      destinationRoot,
      now: () => Date.UTC(2026, 10, 8, 16, 0, 0)
    });
    assert.equal(result.fileCount, 2);
    assert.equal(result.verification, 'SHA256_MATCH');
    assert.equal(fs.readFileSync(path.join(result.backupDir, 'will-history.json'), 'utf8'), fs.readFileSync(path.join(sourceDir, 'will-history.json'), 'utf8'));
    assert.equal(fs.readFileSync(path.join(result.backupDir, 'commissioning-canary', 'state.json'), 'utf8'), fs.readFileSync(path.join(sourceDir, 'commissioning-canary', 'state.json'), 'utf8'));
    const manifest = JSON.parse(fs.readFileSync(path.join(result.backupDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.fileCount, 2);
    assert.equal(manifest.verification, 'SHA256_MATCH');
    assert.equal(fs.existsSync(path.join(sourceDir, 'will-history.json')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime data backup refuses missing, empty, or in-source destinations', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'will-runtime-backup-guards-'));
  const emptyDir = path.join(root, 'empty');
  fs.mkdirSync(emptyDir);
  try {
    await assert.rejects(() => backupRuntimeData({ sourceDir: path.join(root, 'missing'), destinationRoot: root }), /not found/);
    await assert.rejects(() => backupRuntimeData({ sourceDir: emptyDir, destinationRoot: root }), /empty/);
    await assert.rejects(() => backupRuntimeData({ sourceDir: emptyDir, destinationRoot: path.join(emptyDir, 'inside') }), /outside/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
