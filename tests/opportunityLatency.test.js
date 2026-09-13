import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpportunityLatency } from '../backend/src/opportunityLatency.js';

test('opportunity latency records sync and async stages without changing results', async () => {
  let time = 100;
  const latency = createOpportunityLatency({ now: () => time });
  assert.equal(latency.stage('rankingMs', () => { time += 3; return 'ranked'; }), 'ranked');
  assert.equal(await latency.stage('marketFetchMs', async () => { time += 11; return 'fetched'; }), 'fetched');
  assert.equal(latency.snapshot().stages.rankingMs, 3);
  assert.equal(latency.snapshot().stages.marketFetchMs, 11);
});

test('opportunity latency records rejected stages and preserves errors', async () => {
  let time = 0;
  const latency = createOpportunityLatency({ now: () => time });
  await assert.rejects(latency.stage('marketFetchMs', async () => { time = 7; throw new Error('blocked'); }), /blocked/);
  assert.equal(latency.snapshot().stages.marketFetchMs, 7);
});
