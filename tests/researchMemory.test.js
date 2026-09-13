import assert from 'node:assert/strict';
import test from 'node:test';
import { createResearchMemory } from '../learning/src/researchMemory.js';

test('research from a video remains proposed and cannot alter a live rule', () => {
  const memory = createResearchMemory({ id: () => 'research-1', now: () => '2026-09-02T00:00:00.000Z' });
  const item = memory.add({
    source: { type: 'YOUTUBE', author: 'Wil Trader', title: 'Lógica do preço', url: 'https://www.youtube.com/watch?v=L_3FEs93K7c' },
    hypothesis: 'Testar uma leitura de estrutura de preço como filtro adicional.',
    tags: ['price action', 'estrutura']
  });
  assert.equal(item.status, 'PROPOSED');
  assert.equal(memory.list()[0].source.type, 'YOUTUBE');
  assert.throws(() => memory.setStatus('research-1', 'VALIDATED'), /depende de evidência/);
});

test('a hypothesis needs an out-of-sample minimum before becoming validated', () => {
  const memory = createResearchMemory({ id: () => 'research-2', minimumSamples: 30 });
  memory.add({ source: { type: 'USER', title: 'Ideia do operador' }, hypothesis: 'Avaliar filtro de sessão.' });
  const early = memory.recordEvidence('research-2', { completedSignals: 12, wins: 8, losses: 4, validationMethod: 'paper trade', outOfSample: true });
  assert.equal(early.status, 'OBSERVING');
  assert.equal(early.promotionEligible, false);
  const ready = memory.recordEvidence('research-2', { completedSignals: 30, wins: 18, losses: 12, validationMethod: 'paper trade', outOfSample: true });
  assert.equal(ready.status, 'VALIDATED');
  assert.equal(ready.promotionEligible, true);
});

test('research rejects result arithmetic that could fabricate performance', () => {
  const memory = createResearchMemory({ id: () => 'research-3' });
  memory.add({ source: { type: 'USER', title: 'Ideia' }, hypothesis: 'Uma hipótese.' });
  assert.throws(() => memory.recordEvidence('research-3', { completedSignals: 5, wins: 5, losses: 1, validationMethod: 'manual', outOfSample: true }), /Evidência/);
});
