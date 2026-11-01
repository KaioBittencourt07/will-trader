const SAFE_SHA = /^[a-f0-9]{7,64}$/i;
const MAX_PATHS = 30;
const ALLOWED_PREFIXES = [
  'backend/src/engineering/',
  'docs/engineering/'
];
const PROTECTED_SEGMENTS = new Set([
  '.git', '.github', 'data', 'datasets', 'research', 'artifacts',
  'migrations', 'broker', 'brokers', 'secrets', 'credentials'
]);
const PROTECTED_FILES = new Set([
  '.env', '.env.local', '.env.production', 'package.json',
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'
]);

function safeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 240) return null;
  if (value.includes('\\') || value.startsWith('/') || /^[a-z]:/i.test(value)) return null;
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  if (parts.some((part) => PROTECTED_SEGMENTS.has(part.toLowerCase()))) return null;
  if (parts.some((part) => PROTECTED_FILES.has(part.toLowerCase()))) return null;
  return parts.join('/');
}

function isAllowedPath(path) {
  return ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Pure, fail-closed policy check for a future isolated repair worker.
 * It does not inspect Git, access the filesystem, execute commands, or write files.
 */
export function evaluateWorkspaceGuard({
  branch,
  baselineCommit,
  worktreeStatus,
  changedFiles = [],
  requestedPaths = []
} = {}) {
  const reasons = [];
  if (typeof branch !== 'string' || !/^feat\/[a-zA-Z0-9._/-]{1,100}$/.test(branch) ||
      /(^|\/)(main|master|production|release)(\/|$)/i.test(branch)) {
    reasons.push('BRANCH_NOT_ISOLATED');
  }
  if (typeof baselineCommit !== 'string' || !SAFE_SHA.test(baselineCommit)) {
    reasons.push('BASELINE_COMMIT_INVALID');
  }
  if (worktreeStatus !== 'CLEAN') reasons.push('WORKTREE_NOT_CLEAN');
  if (!Array.isArray(changedFiles) || !Array.isArray(requestedPaths)) {
    reasons.push('PATH_LIST_INVALID');
  } else {
    if (changedFiles.length > MAX_PATHS || requestedPaths.length > MAX_PATHS) {
      reasons.push('PATH_LIMIT_EXCEEDED');
    }
    if (requestedPaths.length === 0) reasons.push('NO_REQUESTED_PATHS');
    for (const rawPath of [...changedFiles, ...requestedPaths]) {
      const path = safeRelativePath(rawPath);
      if (!path) {
        reasons.push('UNSAFE_PATH');
        continue;
      }
      if (!isAllowedPath(path)) reasons.push('PATH_OUTSIDE_ALLOWLIST');
    }
  }
  const uniqueReasons = [...new Set(reasons)];
  return Object.freeze({
    policyVersion: 'will-workspace-guard-v1',
    allowed: uniqueReasons.length === 0,
    branch: typeof branch === 'string' ? branch : null,
    baselineCommit: typeof baselineCommit === 'string' && SAFE_SHA.test(baselineCommit)
      ? baselineCommit : null,
    worktreeStatus: ['CLEAN', 'DIRTY', 'UNKNOWN'].includes(worktreeStatus)
      ? worktreeStatus : 'UNKNOWN',
    checkedPathCount: Array.isArray(changedFiles) && Array.isArray(requestedPaths)
      ? changedFiles.length + requestedPaths.length : 0,
    reasons: Object.freeze(uniqueReasons),
    effects: Object.freeze({
      filesWritten: 0,
      commandsExecuted: 0,
      networkRequests: 0,
      brokerCalls: 0
    })
  });
}
