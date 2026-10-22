import { hasConfiguredValue } from './configuredValue.js';

const TWELVE_PLACEHOLDER = 'COLOQUE_SUA_CHAVE_TWELVEDATA_AQUI';

function usable(value, placeholder = null) {
  const normalized = String(value ?? '').trim();
  if (!hasConfiguredValue(normalized)) return null;
  if (placeholder && normalized.toLowerCase() === placeholder.toLowerCase()) return null;
  return normalized;
}

/**
 * Hydrates runtime-only credentials without logging or returning secret values.
 * Environment variables remain the primary source; localSecrets.js is only a
 * local fallback and is ignored by Git.
 */
export async function hydrateRuntimeSecrets({
  env = process.env,
  importer = (specifier) => import(specifier)
} = {}) {
  const envTwelveDataKey = usable(env.TWELVEDATA_API_KEY, TWELVE_PLACEHOLDER);
  let twelveDataSource = envTwelveDataKey ? 'ENV' : null;

  // Do not let a copied .env.example placeholder reach the provider client.
  if (!envTwelveDataKey && env.TWELVEDATA_API_KEY !== undefined) {
    delete env.TWELVEDATA_API_KEY;
  }

  if (!twelveDataSource) {
    try {
      const module = await importer('./localSecrets.js');
      const localKey = usable(module?.localSecrets?.TWELVEDATA_API_KEY, TWELVE_PLACEHOLDER);
      if (localKey) {
        env.TWELVEDATA_API_KEY = localKey;
        twelveDataSource = 'LOCAL_SECRETS';
      }
    } catch (error) {
      if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    }
  }

  return Object.freeze({
    twelveData: Object.freeze({
      configured: Boolean(twelveDataSource),
      source: twelveDataSource
    })
  });
}
