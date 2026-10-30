import assert from 'node:assert/strict';
import test from 'node:test';
import { commissionMarketIntelligenceReadOnly } from '../backend/src/commissionMarketIntelligenceReadOnly.js';

const now = () => Date.parse('2026-09-14T16:30:00.000Z');

function response({ text = '', json = null, status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return text; },
    async json() { return json; }
  };
}

function validBls() {
  return [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTART;TZID=America/New_York:20261014T083000',
    'SUMMARY:Consumer Price Index',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

function validFed() {
  return '<div>2:00 p.m.</div><div>FOMC Meeting</div><div>Two-day meeting, September 15 - 16</div><div>Press Conference</div><div>16</div>';
}

test('commissions BLS + Fed + GDELT with exactly three bounded read-only requests', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes('bls.ics')) return response({ text: validBls() });
    if (String(url).includes('federalreserve.gov')) return response({ text: validFed() });
    if (String(url).includes('gdeltproject.org')) return response({ json: { articles: [
      { title: 'Bitcoin markets watch Federal Reserve meeting', url: 'https://news.example/a', domain: 'news.example', seendate: '20260914T161500Z' }
    ] } });
    return response({ status: 404 });
  };

  const result = await commissionMarketIntelligenceReadOnly({ fetchImpl, now });
  assert.equal(calls.length, 3);
  assert.equal(result.requestsMade, 3);
  assert.equal(result.status, 'APPROVED');
  assert.equal(result.coverage, 'FULL');
  assert.equal(result.macroApproved, true);
  assert.equal(result.newsApproved, true);
  assert.equal(result.observations.gdelt.discoveryOnly, true);
  assert.equal(result.observations.gdelt.hardBlockEligible, false);
  assert.equal(result.rawEventsExposed, false);
  assert.equal(result.rawArticlesExposed, false);
  assert.equal(result.ordersExecuted, 0);
});

test('reports PARTIAL when official macro qualifies but GDELT discovery is rate limited', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('bls.ics')) return response({ text: validBls() });
    if (String(url).includes('federalreserve.gov')) return response({ text: validFed() });
    if (String(url).includes('gdeltproject.org')) return response({ status: 429 });
    return response({ status: 404 });
  };
  const result = await commissionMarketIntelligenceReadOnly({ fetchImpl, now });
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.coverage, 'PARTIAL');
  assert.equal(result.macroApproved, true);
  assert.equal(result.newsApproved, false);
  assert.equal(result.observations.gdelt.error, 'GDELT_DOC_RATE_LIMITED');
  assert.equal(result.observations.gdelt.errorClass, 'RATE_LIMITED');
  assert.equal(result.observations.gdelt.retryRecommended, false);
  assert.equal(result.sourcePolicy.unavailableNewsDoesNotBecomeSafe, true);
  assert.equal(result.decisionImpact, 'NONE');
});

test('fails closed when neither context family can be qualified', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('bls.ics')) return response({ text: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR' });
    if (String(url).includes('federalreserve.gov')) return response({ text: '<div>No FOMC in fixture</div>' });
    return response({ json: { articles: [] } });
  };
  const result = await commissionMarketIntelligenceReadOnly({ fetchImpl, now });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.coverage, 'UNKNOWN');
  assert.equal(result.decisionImpact, 'NONE');
  assert.equal(result.ordersExecuted, 0);
});
