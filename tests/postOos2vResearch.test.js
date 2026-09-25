import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, analyze } from '../research/postOos2vResearch.js';

test('descriptive grouping keeps ties outside binary denominator and marks small cells', () => {
  const rows = [
    { asset: 'A', outcome: 'WIN' },
    { asset: 'A', outcome: 'LOSS' },
    { asset: 'A', outcome: 'TIE' },
    { asset: 'B', outcome: 'TIE' }
  ];
  assert.deepEqual(summarize(rows, r => r.asset), [
    { group: 'A', N: 3, WIN: 1, LOSS: 1, TIE: 1, binaryN: 2, binaryWR: 50, smallN: true },
    { group: 'B', N: 1, WIN: 0, LOSS: 0, TIE: 1, binaryN: 0, binaryWR: null, smallN: true }
  ]);
});

test('research refuses non-frozen history or missing evidence before analysis', () => {
  assert.throws(() => analyze({ historyPath: new URL(import.meta.url), evidenceDir: '.' }), /HISTORY_SNAPSHOT_MISMATCH/);
});
