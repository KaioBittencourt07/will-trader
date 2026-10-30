export const GDELT_NEWS_SOURCE = 'GDELT_DOC_2_ARTICLE_LIST';
export const GDELT_DOC_ENDPOINT = 'https://api.gdeltproject.org/api/v2/doc/doc';

function gdeltTimeToIso(value) {
  const text = String(value ?? '').trim();
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (compact) return new Date(Date.UTC(+compact[1], +compact[2] - 1, +compact[3], +compact[4], +compact[5], +compact[6])).toISOString();
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function currenciesFor(headline = '') {
  const text = String(headline).toUpperCase();
  const currencies = new Set();
  if (/BITCOIN|BTC|CRYPTO|CRYPTOCURRENCY/.test(text)) currencies.add('BTC');
  if (/FEDERAL RESERVE|FOMC|INFLATION|CPI|JOBS|PAYROLL|INTEREST RATE|TREASURY|DOLLAR|USD/.test(text)) currencies.add('USD');
  if (!currencies.size) { currencies.add('BTC'); currencies.add('USD'); }
  return [...currencies];
}

export function parseGdeltArticleList(payload = {}) {
  const articles = Array.isArray(payload?.articles) ? payload.articles : [];
  const seen = new Set();
  const items = [];
  for (const article of articles) {
    const headline = String(article?.title ?? '').trim();
    const timestamp = gdeltTimeToIso(article?.seendate ?? article?.date ?? article?.timestamp);
    const url = String(article?.url ?? '').trim();
    if (!headline || !timestamp || !url) continue;
    const key = `${headline.toLowerCase()}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      headline,
      source: String(article?.domain ?? article?.source ?? 'gdelt').trim() || 'gdelt',
      timestamp,
      currencies: currenciesFor(headline),
      impact: 'UNKNOWN',
      verified: true,
      discoveryOnly: true,
      hardBlockEligible: false,
      url,
      discoverySource: GDELT_NEWS_SOURCE
    });
  }
  return items.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

export function buildGdeltUrl({ query = '(bitcoin OR BTC OR cryptocurrency)', timespan = '60min', maxrecords = 20 } = {}) {
  const url = new URL(GDELT_DOC_ENDPOINT);
  url.searchParams.set('query', query);
  url.searchParams.set('mode', 'ArtList');
  url.searchParams.set('maxrecords', String(Math.min(Math.max(Number(maxrecords) || 20, 1), 100)));
  url.searchParams.set('format', 'json');
  url.searchParams.set('sort', 'DateDesc');
  url.searchParams.set('timespan', timespan);
  return url.toString();
}

export function createGdeltNewsAdapter({ fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = 15_000, query, timespan = '60min', maxrecords = 20 } = {}) {
  return Object.freeze({
    source: GDELT_NEWS_SOURCE,
    async getSnapshot() {
      if (typeof fetchImpl !== 'function') throw new Error('GDELT_FETCH_UNAVAILABLE');
      const url = buildGdeltUrl({ query, timespan, maxrecords });
      const response = await fetchImpl(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'WILL-Trader/4.0 read-only market-context' },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (response.status === 429) throw new Error('GDELT_DOC_RATE_LIMITED');
      if (!response.ok) throw new Error(`GDELT_DOC_HTTP_${response.status}`);
      const payload = await response.json();
      const items = parseGdeltArticleList(payload);
      return { source: GDELT_NEWS_SOURCE, fetchedAt: new Date(now()).toISOString(), items, url, discoveryOnly: true, hardBlockEligible: false };
    }
  });
}
