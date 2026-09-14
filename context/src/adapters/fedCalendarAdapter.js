import { parseAmPm, zonedDateTimeToIso } from './marketTime.js';

export const FED_CALENDAR_SOURCE = 'FEDERAL_RESERVE_OFFICIAL_CALENDAR';

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

export function fedMonthlyCalendarUrl(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = MONTHS[date.getUTCMonth()];
  return `https://www.federalreserve.gov/newsevents/${year}-${month}.htm`;
}

function stripHtml(html = '') {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n');
}

export function parseFedMonthlyCalendar(html = '', { year, month } = {}) {
  const text = stripHtml(html);
  const events = [];
  const regex = /(\d{1,2}:\d{2}\s*[ap]\.m\.)\s*\n?\s*FOMC Meeting\b[\s\S]{0,240}?\b(\d{1,2})\b/gi;
  for (const match of text.matchAll(regex)) {
    const clock = parseAmPm(match[1]);
    const day = Number(match[2]);
    if (!clock || !Number.isFinite(day)) continue;
    const timestamp = zonedDateTimeToIso({ year: Number(year), month: Number(month), day, hour: clock.hour, minute: clock.minute, timeZone: 'America/New_York' });
    if (!timestamp) continue;
    events.push({
      name: 'FOMC',
      currency: 'USD',
      timestamp,
      impact: 'HIGH',
      source: FED_CALENDAR_SOURCE,
      description: 'Federal Open Market Committee policy meeting'
    });
  }
  return events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

export function createFedCalendarAdapter({ fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = 8_000 } = {}) {
  return Object.freeze({
    source: FED_CALENDAR_SOURCE,
    async getSnapshot() {
      if (typeof fetchImpl !== 'function') throw new Error('FED_FETCH_UNAVAILABLE');
      const instant = new Date(now());
      const url = fedMonthlyCalendarUrl(instant);
      const response = await fetchImpl(url, {
        headers: { Accept: 'text/html,*/*;q=0.8', 'User-Agent': 'WILL-Trader/4.0 read-only market-context' },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) throw new Error(`FED_CALENDAR_HTTP_${response.status}`);
      const body = await response.text();
      const events = parseFedMonthlyCalendar(body, { year: instant.getUTCFullYear(), month: instant.getUTCMonth() + 1 });
      if (!events.length) throw new Error('FED_CALENDAR_NO_FOMC_EVENT_IN_MONTH');
      return { source: FED_CALENDAR_SOURCE, fetchedAt: new Date(now()).toISOString(), events, url };
    }
  });
}
