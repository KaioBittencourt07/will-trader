import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareHistoryContinuity } from './historyContinuity.js';

test('preserves existing history and creates a backup before startup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'will-history-'));
  const filePath = path.join(dir, 'will-history.json');
  const records = [{ id: 'a' }, { id: 'b' }];
  fs.writeFileSync(filePath, JSON.stringify(records), 'utf8');

  const result = prepareHistoryContinuity({ filePath });
  assert.equal(result.existing, true);
  assert.equal(result.records, 2);
  assert.equal(result.backupCreated, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), records);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${filePath}.bak`, 'utf8')), records);
});
