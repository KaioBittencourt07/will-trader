import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBlsCalendarIcs } from '../context/src/adapters/blsCalendarAdapter.js';
import { parseFedMonthlyCalendar } from '../context/src/adapters/fedCalendarAdapter.js';
import { buildGdeltUrl, parseGdeltArticleList } from '../context/src/adapters/gdeltNewsAdapter.js';
import { zonedDateTimeToIso } from '../context/src/adapters/marketTime.js';

test('converts New York wall clock to UTC across daylight saving time', () => {
  assert.equal(zonedDateTimeToIso({ year: 2026, month: 9, day: 16, hour: 14, minute: 0, timeZone: 'America/New_York' }), '2026-09-16T18:00:00.000Z');
  assert.equal(zonedDateTimeToIso({ year: 2026, month: 12, day: 9, hour: 14, minute: 0, timeZone: 'America/New_York' }), '2026-12-09T19:00:00.000Z');
});

test('parses BLS official ICS events and marks CPI/NFP/PPI high impact', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTART;TZID=America/New_York:20261014T083000',
    'SUMMARY:Consumer Price Index',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;TZID=America/New_York:20261002T083000',
    'SUMMARY:Employment Situation',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
  const events = parseBlsCalendarIcs(ics);
  assert.equal(events.length, 2);
  assert.equal(events[0].name, 'NFP');
  assert.equal(events[0].impact, 'HIGH');
  assert.equal(events[1].name, 'CPI');
  assert.equal(events[1].timestamp, '2026-10-14T12:30:00.000Z');
});

test('parses the official Fed monthly FOMC event with explicit published time', () => {
  const html = '<section><div>2:00 p.m.</div><div>FOMC Meeting</div><div>Two-day meeting, September 15 - 16</div><div>Press Conference</div><div>16</div></section>';
  const events = parseFedMonthlyCalendar(html, { year: 2026, month: 9 });
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'FOMC');
  assert.equal(events[0].impact, 'HIGH');
  assert.equal(events[0].timestamp, '2026-09-16T18:00:00.000Z');
});

test('uses the second day as FOMC decision day instead of the meeting start day', () => {
  const html = '<div>2:00 p.m.</div><div>FOMC Meeting</div><div>Two-day meeting, December 8 - 9</div><div>Press Conference</div><div>9</div>';
  const events = parseFedMonthlyCalendar(html, { year: 2026, month: 12 });
  assert.equal(events.length, 1);
  assert.equal(events[0].timestamp, '2026-12-09T19:00:00.000Z');
});

test('normalizes and deduplicates GDELT article list without inventing impact', () => {
  const items = parseGdeltArticleList({ articles: [
    { title: 'Bitcoin reacts before Federal Reserve meeting', url: 'https://example.com/a', domain: 'example.com', seendate: '20260914T160000Z' },
    { title: 'Bitcoin reacts before Federal Reserve meeting', url: 'https://example.com/a', domain: 'example.com', seendate: '20260914T160000Z' }
  ] });
  assert.equal(items.length, 1);
  assert.equal(items[0].impact, 'UNKNOWN');
  assert.deepEqual(items[0].currencies.sort(), ['BTC', 'USD']);
  assert.equal(items[0].timestamp, '2026-09-14T16:00:00.000Z');
});

test('builds bounded GDELT read-only query URL', () => {
  const url = new URL(buildGdeltUrl({ timespan: '60min', maxrecords: 20 }));
  assert.equal(url.hostname, 'api.gdeltproject.org');
  assert.equal(url.searchParams.get('mode'), 'ArtList');
  assert.equal(url.searchParams.get('format'), 'json');
  assert.equal(url.searchParams.get('maxrecords'), '20');
});
