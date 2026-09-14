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
