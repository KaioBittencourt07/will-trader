const numberEnv = (name, fallback, min = 0) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < min) throw new Error(`${name} inválido.`);
  return value;
};

export const config = Object.freeze({
  port: numberEnv('PORT', 3000, 1),
  dashboardOrigin: process.env.DASHBOARD_ORIGIN || '*',
  marketMaxAgeMs: numberEnv('MARKET_MAX_AGE_MS', 10_000, 0),
  executionDelayMs: numberEnv('EXECUTION_DELAY_MS', 0, 0),
  executionWindowBeforeMs: numberEnv('EXECUTION_WINDOW_BEFORE_MS', 2_000, 0),
  executionWindowAfterMs: numberEnv('EXECUTION_WINDOW_AFTER_MS', 3_000, 0),
  expirySeconds: numberEnv('EXPIRY_SECONDS', 60, 1),
  openaiModel: process.env.OPENAI_MODEL || 'gpt-5.6-luna'
});
