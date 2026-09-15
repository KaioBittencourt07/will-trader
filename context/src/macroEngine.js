export const IMPACT = Object.freeze({ LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' });

const HIGH_IMPACT = new Set(['FOMC', 'FED_RATE', 'CPI', 'NFP', 'GDP', 'ECB_RATE', 'BOE_RATE', 'PCE']);

export function normalizeEvent(event) {
  const name = String(event?.name ?? 'UNKNOWN').trim();
  const currency = String(event?.currency ?? 'UNKNOWN').toUpperCase();
  const timestamp = event?.timestamp ?? null;
  const impact = event?.impact ?? (HIGH_IMPACT.has(name.toUpperCase()) ? IMPACT.HIGH : IMPACT.MEDIUM);
  return { name, currency, timestamp, impact, actual: event?.actual ?? null, forecast: event?.forecast ?? null, previous: event?.previous ?? null, source: event?.source ?? 'unknown' };
}

export function assessMacroRisk(events = [], now = Date.now(), windowMs = 30 * 60_000) {
  const normalized = events.map(normalizeEvent);
  const nearby = normalized.filter((event) => {
    const time = Date.parse(event.timestamp);
    return Number.isFinite(time) && Math.abs(time - now) <= windowMs;
  });
  const highImpact = nearby.filter((event) => event.impact === IMPACT.HIGH);

  return {
    risk: highImpact.length ? 'HIGH' : nearby.length ? 'MEDIUM' : 'LOW',
    blocked: highImpact.length > 0,
    events: nearby,
    reason: highImpact.length
      ? 'Evento macro de alto impacto dentro da janela de proteção.'
      : nearby.length
        ? 'Eventos próximos exigem cautela.'
        : 'Nenhum evento relevante na janela configurada.'
  };
}
