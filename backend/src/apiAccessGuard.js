import { timingSafeEqual } from 'node:crypto';
import { hasConfiguredValue } from './configuredValue.js';

export const API_ACCESS_TOKEN_ENV = 'WILL_API_ACCESS_TOKEN';

function equalToken(candidate, configured) {
  const left = Buffer.from(String(candidate ?? ''), 'utf8');
  const right = Buffer.from(String(configured ?? ''), 'utf8');
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Protects every /api route when a token is configured.
 * Production startup fails closed when no real token is configured.
 * The health endpoint remains outside /api so the host can probe readiness.
 */
export function createApiAccessGuard({ env = process.env } = {}) {
  const rawToken = String(env[API_ACCESS_TOKEN_ENV] ?? '').trim();
  const configured = hasConfiguredValue(rawToken);
  const production = String(env.NODE_ENV ?? '').trim().toLowerCase() === 'production';

  if (production && !configured) {
    throw new Error('WILL_API_ACCESS_TOKEN_REQUIRED_IN_PRODUCTION');
  }

  return function apiAccessGuard(req, res, next) {
    if (!configured) return next();

    const header = typeof req.get === 'function'
      ? req.get('authorization')
      : req.headers?.authorization;
    const match = typeof header === 'string' ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
    const valid = match && equalToken(match[1].trim(), rawToken);

    if (!valid) {
      return res.status(401).json({
        ok: false,
        error: 'API_ACCESS_TOKEN_REQUIRED'
      });
    }

    return next();
  };
}
