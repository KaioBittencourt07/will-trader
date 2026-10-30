import { assessMacroRisk, normalizeEvent } from './macroEngine.js';
import { classifyNews, summarizeNews } from './newsEngine.js';

export const CONTEXT_VERSION = 'macro-news-context-v1';

export function assetCurrencies(asset = '') {
  const pair = String(asset).trim().toUpperCase().split('/');
  return pair.length === 2 && pair.every((part) => /^[A-Z]{3}$/.test(part)) ? pair : [];
}

function freshness(snapshot = {}, now, maxAgeMs) {
  const timestamp = Date.parse(snapshot.fetchedAt ?? snapshot.timestamp ?? '');
  if (!snapshot.source || !Number.isFinite(timestamp)) return { status: 'UNKNOWN', ageMs: null };
  const ageMs = Math.max(0, now - timestamp);
  return { status: ageMs <= maxAgeMs ? 'FRESH' : 'STALE', ageMs };
}

function related(items, currencies) {
  return items.filter((item) => {
    const impacted = item.currency ? [item.currency] : item.currencies;
    return Array.isArray(impacted) && impacted.some((currency) => currencies.includes(String(currency).toUpperCase()));
  });
}

/** Maps provider snapshots to a replayable, non-directional context contract. */
export function buildMarketContext({ asset, macro = {}, news = {}, now = Date.now(), maxAgeMs = 15 * 60_000, macroWindowMs = 30 * 60_000, newsWindowMs = 30 * 60_000 } = {}) {
  const currencies = assetCurrencies(asset);
  const macroFreshness = freshness(macro, now, maxAgeMs);
  const newsFreshness = freshness(news, now, maxAgeMs);
  const macroEvents = related((macro.events ?? []).map(normalizeEvent), currencies);
  const newsItems = related((news.items ?? []).map(classifyNews), currencies);
  const macroRisk = macroFreshness.status === 'FRESH' ? assessMacroRisk(macroEvents, now, macroWindowMs) : null;
  const newsRisk = newsFreshness.status === 'FRESH' ? summarizeNews(newsItems, now, newsWindowMs) : null;
  return {
    contextVersion: CONTEXT_VERSION,
    asset: asset ?? null,
    currencies,
    macro: { status: macroFreshness.status === 'FRESH' ? macroRisk.risk : 'MACRO_UNKNOWN', blocked: Boolean(macroRisk?.blocked), source: macro.source ?? null, freshness: macroFreshness, events: macroRisk?.events ?? [], reason: macroRisk?.reason ?? 'Calendário macro ausente ou desatualizado.' },
    news: { status: newsFreshness.status === 'FRESH' ? (newsRisk?.blocked ? 'HIGH' : 'NEWS_OK') : 'NEWS_UNKNOWN', blocked: Boolean(newsRisk?.blocked), source: news.source ?? null, freshness: newsFreshness, events: newsRisk?.nearby ?? [], reason: newsFreshness.status === 'FRESH' ? null : 'Fonte de notícias ausente ou desatualizada.' }
  };
}

/** Adapter contract: adapters return {source, fetchedAt, events} or {source, fetchedAt, items}. */
export function createMarketContextProvider({ macroAdapter = null, newsAdapter = null, now = () => Date.now(), options = {} } = {}) {
  async function read(adapter, field) {
    if (!adapter?.getSnapshot) return {};
    try { return await adapter.getSnapshot(); } catch { return { source: adapter.source ?? null, [field]: [] }; }
  }
  return {
    async getContext(asset) {
      const [macro, news] = await Promise.all([read(macroAdapter, 'events'), read(newsAdapter, 'items')]);
      return buildMarketContext({ asset, macro, news, now: now(), ...options });
    }
  };
}
