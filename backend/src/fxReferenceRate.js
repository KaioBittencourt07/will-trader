const CURRENCY_CODE = /^[A-Z]{3}$/;

export async function fetchFrankfurterDailyReference({
  base = 'USD',
  quote = 'BRL',
  fetchImpl = fetch,
  now = () => Date.now(),
  baseUrl = 'https://api.frankfurter.dev/v2',
  timeoutMs = 8_000
} = {}) {
  const normalizedBase = String(base ?? '').trim().toUpperCase();
  const normalizedQuote = String(quote ?? '').trim().toUpperCase();
  if (!CURRENCY_CODE.test(normalizedBase) || !CURRENCY_CODE.test(normalizedQuote) || normalizedBase === normalizedQuote) {
    throw new Error('FX_REFERENCE_CURRENCY_INVALID');
  }

  const normalizedBaseUrl = String(baseUrl).endsWith('/') ? String(baseUrl).slice(0, -1) : String(baseUrl);
  const url = new URL(`${normalizedBaseUrl}/rates`);
  url.searchParams.set('base', normalizedBase);
  url.searchParams.set('quotes', normalizedQuote);
  let response;
  try {
    response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(Math.max(1_000, Math.min(15_000, Number(timeoutMs) || 8_000)))
    });
  } catch (error) {
    const normalized = new Error(error?.name === 'TimeoutError' || error?.name === 'AbortError'
      ? 'FX_REFERENCE_PROVIDER_TIMEOUT' : 'FX_REFERENCE_PROVIDER_UNAVAILABLE');
    normalized.code = error?.name === 'TimeoutError' || error?.name === 'AbortError'
      ? 'FX_REFERENCE_TIMEOUT' : 'FX_REFERENCE_UNAVAILABLE';
    throw normalized;
  }
  if (!response?.ok) {
    const error = new Error(`FX_REFERENCE_PROVIDER_HTTP_${response?.status ?? 0}`);
    error.status = response?.status ?? 0;
    throw error;
  }

  let rows;
  try {
    rows = await response.json();
  } catch {
    throw new Error('FX_REFERENCE_RESPONSE_INVALID');
  }
  if (!Array.isArray(rows)) throw new Error('FX_REFERENCE_RESPONSE_INVALID');

  const row = rows.find((item) =>
    String(item?.base ?? '').toUpperCase() === normalizedBase &&
    String(item?.quote ?? '').toUpperCase() === normalizedQuote);
  const rate = Number(row?.rate);
  const dateText = String(row?.date ?? '');
  if (!row || !Number.isFinite(rate) || rate <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    throw new Error('FX_REFERENCE_RATE_MISSING_OR_INVALID');
  }
  const referenceMs = Date.parse(`${dateText}T00:00:00.000Z`);
  if (!Number.isFinite(referenceMs)) throw new Error('FX_REFERENCE_DATE_INVALID');
  const nowMs = Number(now());
  const evaluatedDateMs = Date.parse(new Date(nowMs).toISOString().slice(0, 10) + 'T00:00:00.000Z');
  const ageDays = Math.floor((evaluatedDateMs - referenceMs) / 86_400_000);
  if (ageDays < 0) throw new Error('FX_REFERENCE_DATE_IN_FUTURE');

  return Object.freeze({
    schemaVersion: 'will-fx-daily-reference-v1',
    provider: 'frankfurter',
    sourceUrl: 'https://frankfurter.dev/',
    base: normalizedBase,
    quote: normalizedQuote,
    pair: `${normalizedBase}/${normalizedQuote}`,
    rate,
    referenceDate: dateText,
    ageDays,
    status: ageDays <= 7 ? 'REFERENCE_OK' : 'REFERENCE_STALE',
    tradingEligible: false,
    signalEligible: false,
    freshnessContract: 'DAILY_REFERENCE_RATE_NOT_INTRADAY_MARKET_QUOTE',
    evaluatedAt: new Date(nowMs).toISOString()
  });
}
