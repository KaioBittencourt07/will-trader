const PLACEHOLDERS = new Set([
  'coloque_sua_chave_aqui',
  'coloque_sua_chave_xai_aqui',
  'coloque_sua_chave_anthropic_aqui',
  'coloque_sua_chave_twelvedata_aqui',
  'configure_um_modelo_disponivel_na_xai',
  'configure_um_modelo_disponivel_na_anthropic'
]);

/**
 * True only for a non-empty configured value, not a literal from .env.example.
 * Comparisons are case-insensitive and never return or log the value.
 */
export function hasConfiguredValue(value) {
  const normalized = String(value ?? '').trim();
  return Boolean(normalized) && !PLACEHOLDERS.has(normalized.toLowerCase());
}
