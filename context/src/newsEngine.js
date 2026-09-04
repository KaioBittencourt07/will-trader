export const NEWS_IMPACT = Object.freeze({ LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', UNKNOWN: 'UNKNOWN' });

export function classifyNews(item) {
  const headline = String(item?.headline ?? '').trim();
  const source = String(item?.source ?? 'unknown').trim();
  const timestamp = item?.timestamp ?? null;
  const explicitImpact = item?.impact;
  const impact = [NEWS_IMPACT.LOW, NEWS_IMPACT.MEDIUM, NEWS_IMPACT.HIGH].includes(explicitImpact) ? explicitImpact : NEWS_IMPACT.UNKNOWN;
  return { headline, source, timestamp, currencies: Array.isArray(item?.currencies) ? item.currencies : [], impact, verified: Boolean(headline && source && Number.isFinite(Date.parse(timestamp))) };
}

export function summarizeNews(items = [], now = Date.now(), windowMs = 30 * 60_000) {
  const news = items.map(classifyNews);
  const nearby = news.filter((item) => Number.isFinite(Date.parse(item.timestamp)) && Math.abs(Date.parse(item.timestamp) - now) <= windowMs);
  const highImpact = nearby.filter((item) => item.impact === NEWS_IMPACT.HIGH);
  return { total: news.length, verified: news.filter((item) => item.verified).length, nearby, highImpact, blocked: highImpact.length > 0 };
}
