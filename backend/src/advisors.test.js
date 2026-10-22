import test from 'node:test';
import assert from 'node:assert/strict';
import { collectAdvisorReviews } from './ai/advisors.js';

test('does not call AI providers when environment values are copied placeholders', async () => {
  const names = [
    'OPENAI_API_KEY',
    'GROK_API_KEY',
    'GROK_MODEL',
    'CLAUDE_API_KEY',
    'CLAUDE_MODEL'
  ];
  const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    OPENAI_API_KEY: 'coloque_sua_chave_aqui',
    GROK_API_KEY: 'coloque_sua_chave_xai_aqui',
    GROK_MODEL: 'configure_um_modelo_disponivel_na_xai',
    CLAUDE_API_KEY: 'coloque_sua_chave_anthropic_aqui',
    CLAUDE_MODEL: 'configure_um_modelo_disponivel_na_anthropic'
  });

  try {
    const result = await collectAdvisorReviews({ market: {}, context: {}, deterministic: {} });
    assert.deepEqual(result, { reviews: [], failures: [] });
  } finally {
    for (const name of names) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  }
});
