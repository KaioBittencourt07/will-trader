export function isDeterministicFallbackEnabled(env = process.env) {
  const configured = env.AI_FALLBACK_ENABLED ?? env.ALLOW_DETERMINISTIC_FALLBACK;
  if (configured === undefined || configured === null || String(configured).trim() === '') {
    return true;
  }
  return ['true', '1', 'yes'].includes(String(configured).trim().toLowerCase());
}
