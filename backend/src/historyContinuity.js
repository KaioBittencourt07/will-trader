import fs from 'node:fs';
import path from 'node:path';

export const HISTORY_CONTINUITY_VERSION = 'will-history-continuity-v1';

export function prepareHistoryContinuity({ filePath } = {}) {
  if (!filePath) throw new Error('WILL_HISTORY_FILE_PATH_REQUIRED');
  const absolute = path.resolve(filePath);
  const backupPath = `${absolute}.bak`;

  if (!fs.existsSync(absolute)) {
    return Object.freeze({
      version: HISTORY_CONTINUITY_VERSION,
      existing: false,
      records: 0,
      backupCreated: false,
      filePath: absolute,
      backupPath
    });
  }

  const raw = fs.readFileSync(absolute, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('WILL_HISTORY_INVALID_NON_ARRAY');

  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  const temporary = `${backupPath}.tmp`;
  fs.writeFileSync(temporary, raw, 'utf8');
  fs.renameSync(temporary, backupPath);

  return Object.freeze({
    version: HISTORY_CONTINUITY_VERSION,
    existing: true,
    records: parsed.length,
    backupCreated: true,
    filePath: absolute,
    backupPath
  });
}
