import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CHAMPION_FREEZE, assertChampionFrozen, createProspectiveEvidenceRecord, createProspectiveManifest, evAvailability } from '../learning/src/prospectiveEvidence.js';
import { createHistoryStore } from '../learning/src/historyStore.js';

test('prospective manifest freezes the Champion and has no arbitrary edge sample claim', () => {
  const manifest = createProspectiveManifest({ startTime: '2026-09-03T02:15:00.000Z' });
  assert.equal(manifest.mode, 'PAPER');
  assert.equal(manifest.executionMode, 'MANUAL');
  assert.equal(Object.isFrozen(manifest.champion), true);
  assert.equal(manifest.targetEvidencePolicy.kind, 'NO_PREDECLARED_EDGE_N');
  assert.throws(() => assertChampionFrozen(manifest, { strategyVersion: 'will-core-v1.1' }), /divergente/);
  assert.equal(assertChampionFrozen(manifest, { strategyVersion: CHAMPION_FREEZE.strategyVersion }), true);
});

test('prospective evidence logs BUY, SELL and WAIT without outcome or future leakage', () => {
  for (const direction of ['BUY', 'SELL', 'WAIT']) {
    const record = createProspectiveEvidenceRecord({
      decision: { direction, executable: direction !== 'WAIT', generatedAt: '2026-09-03T02:15:00.000Z', clickTime: '2026-09-03T02:16:00.000Z', validFrom: '2026-09-03T02:16:00.000Z', validUntil: '2026-09-03T02:16:05.000Z', outcome: 'WIN' },
      data: { asset: 'EUR/USD', timeframe: '1min', price: 1.1, valid: true, status: 'OK', source: 'feed' },
      context: { rankingSelected: direction === 'BUY', mtfContext: { agreement: 'AGREE' }, providerHealth: 'HEALTHY' }
    });
    assert.equal(record.decision, direction);
    assert.equal(record.outcome.status, 'PENDING');
    assert.equal(record.outcome.status, 'PENDING');
    assert.equal(record.disposition, direction === 'WAIT' ? 'REJECTED' : direction === 'BUY' ? 'SELECTED' : 'EXECUTABLE_UNSELECTED');
  }
});

test('prospective history persists an audit decision id and is idempotent across restart', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'will-prospective-'));
  const filePath = path.join(directory, 'history.json');
  try {
    const input = { audit: { id: 'cycle-1', createdAt: '2026-09-03T02:15:00.000Z' }, decision: { direction: 'BUY', executable: true, clickTime: '2026-09-03T02:16:00.000Z' }, data: { asset: 'EUR/USD', timeframe: '1min', price: 1.1, valid: true, status: 'OK' } };
    const first = createHistoryStore({ filePath, id: () => 'record-1' });
    first.recordDecision(input);
    const restarted = createHistoryStore({ filePath, id: () => 'record-2' });
    const repeated = restarted.recordDecision(input);
    assert.equal(repeated.idempotent, true);
    assert.equal(restarted.list().length, 1);
    assert.equal(restarted.list()[0].metadata.prospective.decisionId, 'cycle-1');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('prospective evidence marks unavailable payout and costs without synthetic EV', () => {
  assert.deepEqual(evAvailability(), { status: 'NOT_AVAILABLE', reason: 'VALID_PAYOUT_AND_COSTS_REQUIRED' });
  assert.deepEqual(evAvailability({ payout: 0.8, costs: 0.02 }), { status: 'AVAILABLE_FOR_FUTURE_ANALYSIS' });
});

