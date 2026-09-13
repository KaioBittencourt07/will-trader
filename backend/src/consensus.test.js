import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConsensus } from './consensus.js';

test('approves matching strong AI confirmation', () => {
  const result = resolveConsensus(
    {
      direction: 'BUY',
      executable: true,
      confidence: 80,
      clickTime: '2026-08-27T17:00:00.000Z',
      timing: {
        clickTime: '2026-08-27T17:00:00.000Z',
        validFrom: '2026-08-27T16:59:58.000Z',
        validUntil: '2026-08-27T17:00:03.000Z',
        expiryTime: '2026-08-27T17:01:00.000Z'
      }
    },
    {
      direction: 'BUY',
      confidence: 90,
      score: 0.9,
      thesis: 'Tendência confirmada',
      risks: []
    }
  );

  assert.equal(result.approved, true);
  assert.equal(result.decision.direction, 'BUY');
  assert.equal(result.decision.clickTime, '2026-08-27T17:00:00.000Z');
  assert.equal(result.decision.timing.validUntil, '2026-08-27T17:00:03.000Z');
});

test('vetoes opposite AI direction', () => {
  const result = resolveConsensus(
    {
      direction: 'BUY',
      executable: true,
      confidence: 80,
      clickTime: '2026-08-27T17:00:00.000Z'
    },
    {
      direction: 'SELL',
      confidence: 90
    }
  );

  assert.equal(result.approved, false);
  assert.equal(result.decision.direction, 'WAIT');
  assert.equal(result.decision.executable, false);
  assert.equal(result.decision.clickTime, null);
});

test('vetoes weak AI confidence', () => {
  const result = resolveConsensus(
    {
      direction: 'BUY',
      executable: true,
      confidence: 80,
      clickTime: '2026-08-27T17:00:00.000Z'
    },
    {
      direction: 'BUY',
      confidence: 69
    }
  );

  assert.equal(result.approved, false);
  assert.equal(result.decision.direction, 'WAIT');
  assert.equal(result.decision.executable, false);
});
