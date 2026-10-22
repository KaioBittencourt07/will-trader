const numberEnv = (name, fallback, min = 0) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < min) throw new Error(`${name} inválido.`);
  return value;
};

export function resolveDashboardOrigin(env = process.env) {
  const configured = String(env.DASHBOARD_ORIGIN ?? '').trim();
  const production = String(env.NODE_ENV ?? '').trim().toLowerCase() === 'production';

  if (!configured || configured === '*') {
    if (production) throw new Error('DASHBOARD_ORIGIN_REQUIRED_IN_PRODUCTION');
    return '*';
  }

  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error('DASHBOARD_ORIGIN_INVALID');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username || parsed.password || parsed.search || parsed.hash ||
      parsed.pathname !== '/') {
    throw new Error('DASHBOARD_ORIGIN_INVALID');
  }
  return parsed.origin;
}

export const config = Object.freeze({
  port: numberEnv('PORT', 3000, 1),
  dashboardOrigin: resolveDashboardOrigin(),
  marketMaxAgeMs: numberEnv('MARKET_MAX_AGE_MS', 10_000, 0),
  executionDelayMs: numberEnv('EXECUTION_DELAY_MS', 0, 0),
  executionWindowBeforeMs: numberEnv('EXECUTION_WINDOW_BEFORE_MS', 2_000, 0),
  executionWindowAfterMs: numberEnv('EXECUTION_WINDOW_AFTER_MS', 3_000, 0),
  expirySeconds: numberEnv('EXPIRY_SECONDS', 60, 1),
  openaiModel: process.env.OPENAI_MODEL || 'gpt-6-luna'
});
