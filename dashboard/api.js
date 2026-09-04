const params = new URLSearchParams(window.location.search);

function getBaseUrl() {
  const configured = window.WILL_API_BASE_URL || localStorage.getItem('willApiBase') || params.get('api') || '';
  return configured.replace(/\/$/, '');
}

export const WILL_API = {
  get baseUrl() { return getBaseUrl(); },
  healthPath: '/health',
  marketPath: '/api/market',
  marketStatusPath: '/api/market/status',
  analyzePath: '/api/analyze',
  paperOrderPath: '/api/paper/order',
  historyPath: '/api/history',
  metricsPath: '/api/metrics',
  executionStatusPath: '/api/execution/status',
  opportunitiesPath: '/api/opportunities'
};

async function request(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {}
    throw new Error(message);
  }
  return response.json();
}

export function getHealth() {
  return request(`${WILL_API.baseUrl}${WILL_API.healthPath}`);
}

export function getMarketSnapshot(asset = 'EUR/USD', timeframe = '1min') {
  const query = new URLSearchParams({ asset, timeframe, outputsize: '50' });
  return request(`${WILL_API.baseUrl}${WILL_API.marketPath}?${query}`);
}

export function getMarketStatus() {
  return request(`${WILL_API.baseUrl}${WILL_API.marketStatusPath}`);
}

export function analyzeMarket(market, context = {}) {
  return request(`${WILL_API.baseUrl}${WILL_API.analyzePath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ market, context })
  });
}

export function createPaperOrder(signal, stake = 1) {
  return request(`${WILL_API.baseUrl}${WILL_API.paperOrderPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signal, stake })
  });
}

export function getHistory(limit = 100) {
  return request(`${WILL_API.baseUrl}${WILL_API.historyPath}?limit=${encodeURIComponent(limit)}`);
}

export function getMetrics() {
  return request(`${WILL_API.baseUrl}${WILL_API.metricsPath}`);
}

export function registerOutcome(id, outcome, metadata = {}) {
  return request(`${WILL_API.baseUrl}${WILL_API.historyPath}/${encodeURIComponent(id)}/outcome`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outcome, ...metadata })
  });
}

export function confirmExecution(id, execution = {}) {
  return request(`${WILL_API.baseUrl}${WILL_API.historyPath}/${encodeURIComponent(id)}/executed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(execution)
  });
}

export function getExecutionStatus() {
  return request(`${WILL_API.baseUrl}${WILL_API.executionStatusPath}`);
}

export function getMultiTimeframe(asset = 'EUR/USD', timeframes = '1min,5min,15min') {
  const query = new URLSearchParams({ asset, timeframes, outputsize: '50' });
  return request(`${WILL_API.baseUrl}/api/market/multi?${query}`);
}

export function scanOpportunities(timeframe = '1min', entryDelaySeconds = 120) {
  return request(`${WILL_API.baseUrl}${WILL_API.opportunitiesPath}?${new URLSearchParams({ timeframe, entryDelaySeconds })}`);
}

export async function scanLegacyOpportunities() {
  const asset = 'EUR/USD';
  const market = await getMarketSnapshot(asset, '1min');
  const analysis = await analyzeMarket(market.snapshot, { dataValid: true, expirySeconds: 60 });
  const candidate = { asset, snapshot: market.snapshot, decision: analysis.decision || analysis };
  const executable = candidate.decision?.executable && !candidate.decision.blocked && ['BUY', 'SELL'].includes(candidate.decision.direction);
  return { ok: true, recommendation: executable ? candidate : null, reason: executable ? 'Sinal executável encontrado no modo compatível.' : 'Modo compatível: EUR/USD não atingiu os critérios. WAIT é correto.' };
}
