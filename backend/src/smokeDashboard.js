import 'dotenv/config';
import { config } from './config.js';

const configuredBaseUrl = process.env.WILL_BASE_URL || process.argv[2];
const baseUrl = (configuredBaseUrl || `http://127.0.0.1:${config.port}`).replace(/\/$/, '');

async function read(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, { cache: 'no-store' });
  const text = await response.text();
  return { response, text };
}

async function main() {
  const health = await read('/health');
  if (!health.response.ok) {
    throw new Error(`Health check falhou: HTTP ${health.response.status}`);
  }

  let healthBody;
  try {
    healthBody = JSON.parse(health.text);
  } catch {
    throw new Error('Health check não retornou JSON válido.');
  }

  if (healthBody?.ok !== true) {
    throw new Error('Backend respondeu, mas health.ok não é true.');
  }

  const dashboard = await read('/dashboard/');
  if (!dashboard.response.ok) {
    throw new Error(`Dashboard falhou: HTTP ${dashboard.response.status}`);
  }

  const requiredMarkers = ['WILL TRADER', 'ROTACIONAR MERCADO E ANALISAR'];
  const missing = requiredMarkers.filter((marker) => !dashboard.text.includes(marker));
  if (missing.length) {
    throw new Error(`Dashboard respondeu, mas faltam marcadores esperados: ${missing.join(', ')}`);
  }

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    health: {
      ok: healthBody.ok,
      marketConfigured: Boolean(healthBody.marketConfigured),
      openaiConfigured: Boolean(healthBody.openaiConfigured)
    },
    dashboard: {
      status: dashboard.response.status,
      bytes: Buffer.byteLength(dashboard.text),
      markers: requiredMarkers
    },
    open: `${baseUrl}/dashboard/`
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    baseUrl,
    error: error.message,
    hint: 'Mantenha npm.cmd start rodando e passe a URL exata: npm.cmd run smoke:dashboard -- http://127.0.0.1:PORT'
  }, null, 2));
  process.exitCode = 1;
});
