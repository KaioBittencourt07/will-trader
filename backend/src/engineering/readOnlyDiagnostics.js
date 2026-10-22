const SECRET_KEY_PATTERN = /(?:api[_-]?key|access[_-]?token|auth(?:orization)?|password|passwd|secret|credential|cookie|session[_-]?id)/i;
const SECRET_ASSIGNMENT_PATTERN = /\b(api[_-]?key|access[_-]?token|token|authorization|password|passwd|secret|credential|cookie|session[_-]?id)\b\s*([=:])\s*(?:"[^"]*"|'[^']*'|Bearer\s+[^\s,;]+|[^\s,;]+)/gi;
const URL_QUERY_SECRET_PATTERN = /([?&](?:api[_-]?key|access[_-]?token|token|key|secret|password)=)[^&#\s]*/gi;
const MAX_TEXT_LENGTH = 4_000;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SAFE_SHA = /^[a-f0-9]{7,64}$/i;

export function redactDiagnosticText(value, maxLength = MAX_TEXT_LENGTH) {
  const text = String(value ?? '')
    .replace(SECRET_ASSIGNMENT_PATTERN, (_match, key, separator) => `${key}${separator}[REDACTED]`)
    .replace(URL_QUERY_SECRET_PATTERN, '$1[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_API_KEY]');
  const limit = Number.isInteger(maxLength) ? Math.max(0, Math.min(maxLength, MAX_TEXT_LENGTH)) : MAX_TEXT_LENGTH;
  return text.length > limit ? `${text.slice(0, limit)}…[TRUNCATED]` : text;
}

function classifyIssue(code, message) {
  const text = `${code ?? ''} ${message ?? ''}`.toLowerCase();
  if (/eacces|permission|unauthorized|forbidden|secret|credential|token leak|security/.test(text)) {
    return { category: 'SECURITY', severity: 'HIGH', confidence: 0.85 };
  }
  if (/429|rate.?limit|retry-after|quota|credit budget/.test(text)) {
    return { category: 'PROVIDER_RATE_LIMIT', severity: 'MEDIUM', confidence: 0.9 };
  }
  if (/timeout|econnreset|enotfound|network|provider unavailable|http_5\d\d/.test(text)) {
    return { category: 'PROVIDER_OR_NETWORK', severity: 'MEDIUM', confidence: 0.8 };
  }
  if (/\bassert(?:ion)?\b|\btest failed\b|\bexpected\b|\bactual\b|err_assertion/.test(text)) {
    return { category: 'TEST_OR_CONTRACT', severity: 'MEDIUM', confidence: 0.75 };
  }
  if (/syntaxerror|err_module_not_found|cannot find module|referenceerror|typeerror/.test(text)) {
    return { category: 'RUNTIME_OR_DEPENDENCY', severity: 'HIGH', confidence: 0.8 };
  }
  return { category: 'UNKNOWN', severity: 'LOW', confidence: 0.35 };
}

/**
 * Build a read-only, redacted incident report. This function does not inspect
 * process.env, access files, invoke commands, make network requests, or patch code.
 */
export function createReadOnlyDiagnosticReport({
  issue = 'Unspecified engineering issue',
  baselineCommit = null,
  branch = null,
  worktreeStatus = 'UNKNOWN',
  command = null,
  exitCode = null,
  error = null,
  output = '',
  observedAt = new Date().toISOString()
} = {}) {
  const message = redactDiagnosticText(error?.message ?? error ?? '');
  const codeCandidate = String(error?.code ?? '');
  const code = SAFE_CODE.test(codeCandidate) ? codeCandidate : null;
  const classification = classifyIssue(code, message);
  const status = ['CLEAN', 'DIRTY', 'UNKNOWN'].includes(worktreeStatus) ? worktreeStatus : 'UNKNOWN';
  const safeCommit = typeof baselineCommit === 'string' && SAFE_SHA.test(baselineCommit) ? baselineCommit : null;
  const safeBranch = typeof branch === 'string' ? redactDiagnosticText(branch, 120).replace(/[^a-zA-Z0-9._/-]/g, '_') : null;
  const validExitCode = Number.isInteger(exitCode) && exitCode >= -1 && exitCode <= 255 ? exitCode : null;
  const date = Date.parse(observedAt);
  return Object.freeze({
    schemaVersion: 'will-read-only-diagnostic-v1',
    mode: 'READ_ONLY',
    issue: redactDiagnosticText(issue, 240),
    observedAt: Number.isFinite(date) ? new Date(date).toISOString() : null,
    baselineCommit: safeCommit,
    branch: safeBranch,
    worktreeStatus: status,
    command: command ? redactDiagnosticText(command, 500) : null,
    exitCode: validExitCode,
    error: Object.freeze({ code, message }),
    classification: Object.freeze(classification),
    output: redactDiagnosticText(output, MAX_TEXT_LENGTH),
    actionsTaken: Object.freeze([]),
    patchCreated: false,
    filesWritten: 0,
    networkRequests: 0,
    brokerCalls: 0,
    unresolved: Object.freeze([
      'Report classification is heuristic and requires human review.',
      'No commands were executed and no repository state was independently inspected.'
    ])
  });
}
