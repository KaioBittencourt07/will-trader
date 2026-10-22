import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateRuntimeSecrets } from './runtimeSecrets.js';

test('prefers TWELVEDATA_API_KEY from environment', async () => {
  const env = { TWELVEDATA_API_KEY: 'env-key' };
  let imported = false;
  const result = await hydrateRuntimeSecrets({
    env,
    importer: async () => {
      imported = true;
      return { localSecrets: { TWELVEDATA_API_KEY: 'local-key' } };
    }
  });

  assert.equal(result.twelveData.configured, true);
  assert.equal(result.twelveData.source, 'ENV');
  assert.equal(env.TWELVEDATA_API_KEY, 'env-key');
  assert.equal(imported, false);
});

test('hydrates Twelve key from localSecrets fallback without exposing the value', async () => {
  const env = {};
  const result = await hydrateRuntimeSecrets({
    env,
    importer: async () => ({ localSecrets: { TWELVEDATA_API_KEY: 'local-key' } })
  });

  assert.equal(result.twelveData.configured, true);
  assert.equal(result.twelveData.source, 'LOCAL_SECRETS');
  assert.equal(env.TWELVEDATA_API_KEY, 'local-key');
  assert.deepEqual(Object.keys(result.twelveData).sort(), ['configured', 'source']);
});

test('leaves Twelve unconfigured when local secret is missing or placeholder', async () => {
  const env = {};
  const result = await hydrateRuntimeSecrets({
    env,
    importer: async () => ({
      localSecrets: { TWELVEDATA_API_KEY: 'COLOQUE_SUA_CHAVE_TWELVEDATA_AQUI' }
    })
  });

  assert.equal(result.twelveData.configured, false);
  assert.equal(result.twelveData.source, null);
  assert.equal(env.TWELVEDATA_API_KEY, undefined);
});


test('ignores the case-insensitive .env.example placeholder from the environment', async () => {
  const env = { TWELVEDATA_API_KEY: 'coloque_sua_chave_twelvedata_aqui' };
  const result = await hydrateRuntimeSecrets({
    env,
    importer: async () => {
      const error = new Error('optional local secret file does not exist');
      error.code = 'ERR_MODULE_NOT_FOUND';
      throw error;
    }
  });

  assert.equal(result.twelveData.configured, false);
  assert.equal(result.twelveData.source, null);
  assert.equal(env.TWELVEDATA_API_KEY, undefined);
});

test('rejects a localSecrets placeholder regardless of letter case', async () => {
  const env = {};
  const result = await hydrateRuntimeSecrets({
    env,
    importer: async () => ({
      localSecrets: { TWELVEDATA_API_KEY: 'coloque_sua_chave_twelvedata_aqui' }
    })
  });

  assert.equal(result.twelveData.configured, false);
  assert.equal(result.twelveData.source, null);
  assert.equal(env.TWELVEDATA_API_KEY, undefined);
});
