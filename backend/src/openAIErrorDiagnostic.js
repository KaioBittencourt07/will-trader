export function classifyOpenAIProviderError(error = {}) {
  const status = Number.isFinite(Number(error.status)) ? Number(error.status) : null;
  const code = typeof error.code === 'string' ? error.code.slice(0, 120) : null;
  const type = typeof error.type === 'string' ? error.type.slice(0, 120) : null;
  const name = typeof error.name === 'string' ? error.name.slice(0, 120) : null;

  let classification = 'OPENAI_PROVIDER_ERROR';
  if (status === 401 || code === 'invalid_api_key') classification = 'OPENAI_AUTHENTICATION_FAILED';
  else if (status === 403) classification = 'OPENAI_PERMISSION_DENIED';
  else if (status === 404 || code === 'model_not_found') classification = 'OPENAI_MODEL_UNAVAILABLE';
  else if (status === 429 || code === 'insufficient_quota' || code === 'rate_limit_exceeded') classification = 'OPENAI_RATE_OR_QUOTA_BLOCKED';
  else if (status === 400) classification = 'OPENAI_REQUEST_REJECTED';
  else if (String(name ?? '').toLowerCase().includes('timeout')) classification = 'OPENAI_TIMEOUT';

  return Object.freeze({ classification, status, code, type, name });
}
