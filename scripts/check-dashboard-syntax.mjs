import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dashboardPath = path.join(repositoryRoot, 'dashboard', 'index.html');
const html = readFileSync(dashboardPath, 'utf8');
const modules = [...html.matchAll(/<script\\b[^>]*type=["']module["'][^>]*>([\\s\\S]*?)<\\/script>/gi)];

if (modules.length === 0) {
  throw new Error('DASHBOARD_MODULE_SCRIPT_NOT_FOUND');
}

const tempDir = mkdtempSync(path.join(tmpdir(), 'will-dashboard-syntax-'));
try {
  modules.forEach((match, index) => {
    const sourcePath = path.join(tempDir, `dashboard-module-${index + 1}.mjs`);
    writeFileSync(sourcePath, match[1], 'utf8');
    const check = spawnSync(process.execPath, ['--check', sourcePath], { encoding: 'utf8' });
    if (check.status !== 0) {
      process.stderr.write(`Dashboard module syntax check failed (module ${index + 1}).\\n`);
      if (check.stdout) process.stderr.write(check.stdout);
      if (check.stderr) process.stderr.write(check.stderr);
      process.exitCode = check.status ?? 1;
    }
  });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

if (process.exitCode && process.exitCode !== 0) process.exit(process.exitCode);
console.log(`Dashboard syntax OK: ${modules.length} inline module script(s).`);
