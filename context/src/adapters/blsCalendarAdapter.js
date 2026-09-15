import { compactTimestampToIso } from './marketTime.js';

export const BLS_CALENDAR_SOURCE = 'BLS_OFFICIAL_RELEASE_CALENDAR';
export const BLS_CALENDAR_URL = 'https://www.bls.gov/schedule/news_release/bls.ics';

function unfold(text = '') {
  return String(text).replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
}

function decodeIcsText(value = '') {
  return String(value).replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();
}

function classify(summary = '') {
  const upper = summary.toUpperCase();
  if (/CONSUMER PRICE INDEX|EMPLOYMENT SITUATION|PRODUCER PRICE INDEX/.test(upper)) return { impact: 'HIGH', name: upper.includes('EMPLOYMENT SITUATION') ? 'NFP' : upper.includes('CONSUMER PRICE INDEX') ? 'CPI' : 'PPI' };
  if (/JOB OPENINGS|JOLTS|EMPLOYMENT COST|PRODUCTIVITY/.test(upper)) return { impact: 'MEDIUM', name: summary };
  return { impact: 'LOW', name: summary };
}

function dtstartFromLine(line) {
  const match = String(line).match(/^DTSTART(?:;TZID=([^:]+))?:(.+)$/i);
  if (!match) return null;
  const zone = match[1] || 'America/New_York';
  return compactTimestampToIso(match[2], { timeZone: zone });
}

export function parseBlsCalendarIcs(text = '') {
  const lines = unfold(text);
  const events = [];
  let current = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { current = {}; continue; }
    if (line === 'END:VEVENT') {
      if (current?.summary && current?.timestamp) {
        const classification = classify(current.summary);
        events.push({
          name: classification.name,
          currency: 'USD',
          timestamp: current.timestamp,
          impact: classification.impact,
          source: BLS_CALENDAR_SOURCE,
          description: current.summary
        });
      }
      current = null;
      continue;
    }
    if (!current) continue;
    if (line.startsWith('SUMMARY:')) current.summary = decodeIcsText(line.slice('SUMMARY:'.length));
    if (line.startsWith('DTSTART')) current.timestamp = dtstartFromLine(line);
  }
  return events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

export function createBlsCalendarAdapter({ fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = 8_000 } = {}) {
  return Object.freeze({
    source: BLS_CALENDAR_SOURCE,
    async getSnapshot() {
      if (typeof fetchImpl !== 'function') throw new Error('BLS_FETCH_UNAVAILABLE');
      const response = await fetchImpl(BLS_CALENDAR_URL, {
        headers: { Accept: 'text/calendar,text/plain;q=0.9,*/*;q=0.1', 'User-Agent': 'WILL-Trader/4.0 read-only market-context' },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) throw new Error(`BLS_CALENDAR_HTTP_${response.status}`);
      const body = await response.text();
      const events = parseBlsCalendarIcs(body);
      if (!events.length) throw new Error('BLS_CALENDAR_NO_EVENTS');
      return { source: BLS_CALENDAR_SOURCE, fetchedAt: new Date(now()).toISOString(), events };
    }
  });
}
