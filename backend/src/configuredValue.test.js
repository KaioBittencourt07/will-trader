import test from 'node:test';
import assert from 'node:assert/strict';
import { hasConfiguredValue } from './configuredValue.js';

test('rejects example placeholders without depending on letter case', () => {
  for (const value of [
    'coloque_sua_chave_aqui',
    'COLOQUE_SUA_CHAVE_XAI_AQUI',
    'coloque_sua_chave_anthropic_aqui',
    'coloque_sua_chave_twelvedata_aqui',
    'CONFIGURE_UM_MODELO_DISPONIVEL_NA_XAI',
    'configure_um_modelo_disponivel_na_anthropic'
  ]) {
    assert.equal(hasConfiguredValue(value), false, value);
  }
});

test('accepts actual non-empty configured values and rejects empty ones', () => {
  assert.equal(hasConfiguredValue('sk-proj-example-real-looking-value'), true);
  assert.equal(hasConfiguredValue('some-model'), true);
  assert.equal(hasConfiguredValue('  '), false);
  assert.equal(hasConfiguredValue(undefined), false);
});
