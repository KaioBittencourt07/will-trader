import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const script = readFileSync(new URL('../scripts/backup-local-workspace.ps1', import.meta.url), 'utf8');

test('Windows workspace backup is copy-only and excludes secret files', () => {
  assert.match(script, /robocopy/);
  assert.match(script, /git -C \$source diff --binary HEAD/);
  assert.match(script, /\.env/);
  assert.match(script, /Sensitive files were intentionally excluded/);
  assert.match(script, /No source files were deleted or modified/);
  assert.doesNotMatch(script, /Remove-Item|git reset|git clean|git checkout|git push/i);
});
