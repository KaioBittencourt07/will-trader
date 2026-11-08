import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function sha256(filePath) {
  const bytes = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function collectFiles(root, current = root, output = []) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    const stat = await fs.lstat(fullPath);
    if (stat.isSymbolicLink()) throw new Error('Runtime data backup refuses symlinks: ' + path.relative(root, fullPath));
    if (stat.isDirectory()) await collectFiles(root, fullPath, output);
    else if (stat.isFile()) output.push(fullPath);
    else throw new Error('Unsupported runtime data entry: ' + path.relative(root, fullPath));
  }
  return output;
}

export async function backupRuntimeData({
  sourceDir = path.resolve(process.cwd(), 'backend/data'),
  destinationRoot = path.resolve(process.cwd(), '..'),
  now = () => Date.now()
} = {}) {
  const source = path.resolve(sourceDir);
  const destination = path.resolve(destinationRoot);
  const sourceStat = await fs.lstat(source).catch(() => null);
  if (!sourceStat || !sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new Error('Runtime data directory not found or not a safe directory: ' + source);
  }
  if (destination === source || destination.startsWith(source + path.sep)) {
    throw new Error('Backup destination must be outside the runtime data directory.');
  }

  const files = await collectFiles(source);
  if (!files.length) throw new Error('Runtime data directory is empty; refusing to report an empty backup.');

  await fs.mkdir(destination, { recursive: true });
  const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
  let backupDir = path.join(destination, 'will-runtime-data-backup-' + stamp);
  let suffix = 1;
  while (await fs.stat(backupDir).then(() => true).catch(() => false)) {
    backupDir = path.join(destination, 'will-runtime-data-backup-' + stamp + '-' + suffix);
    suffix += 1;
  }

  await fs.mkdir(backupDir, { recursive: false });
  try {
    const manifestFiles = [];
    let totalBytes = 0;
    for (const sourceFile of files) {
      const relativePath = path.relative(source, sourceFile);
      const targetFile = path.join(backupDir, relativePath);
      await fs.mkdir(path.dirname(targetFile), { recursive: true });
      await fs.copyFile(sourceFile, targetFile);
      const [sourceHash, targetHash, stat] = await Promise.all([
        sha256(sourceFile), sha256(targetFile), fs.stat(sourceFile)
      ]);
      if (sourceHash !== targetHash) throw new Error('SHA-256 verification failed: ' + relativePath);
      totalBytes += stat.size;
      manifestFiles.push({ path: relativePath, sizeBytes: stat.size, sha256: sourceHash });
    }

    const manifest = {
      createdAt: new Date(now()).toISOString(),
      source: 'backend/data',
      verification: 'SHA256_MATCH',
      fileCount: manifestFiles.length,
      totalBytes,
      files: manifestFiles
    };
    await fs.writeFile(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    return Object.freeze({ backupDir, fileCount: manifestFiles.length, totalBytes, verification: manifest.verification, manifest });
  } catch (error) {
    await fs.rm(backupDir, { recursive: true, force: true });
    throw error;
  }
}

function parseArgument(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? path.resolve(args[index + 1]) : fallback;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    const result = await backupRuntimeData({
      sourceDir: parseArgument(args, '--source', path.resolve(process.cwd(), 'backend/data')),
      destinationRoot: parseArgument(args, '--out', path.resolve(process.cwd(), '..'))
    });
    process.stdout.write(JSON.stringify({
      backupDir: result.backupDir,
      fileCount: result.fileCount,
      totalBytes: result.totalBytes,
      verification: result.verification
    }, null, 2) + '\n');
  } catch (error) {
    process.stderr.write('BACKUP FAILED: ' + error.message + '\n');
    process.exitCode = 1;
  }
}
