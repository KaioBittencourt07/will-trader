import 'dotenv/config';
import { runOandaTemporalCommissioning } from './oandaTemporalCommissioning.js';

async function loadLocalSecrets() {
  try {
    const module = await import('./localSecrets.js');
    return module.localSecrets ?? {};
  } catch {
    return {};
  }
}

const localSecrets = await loadLocalSecrets();
const token = process.env.OANDA_TOKEN || localSecrets.OANDA_TOKEN || null;
const accountId = process.env.OANDA_ACCOUNT_ID || localSecrets.OANDA_ACCOUNT_ID || null;

const report = await runOandaTemporalCommissioning({ token, accountId });
console.log(JSON.stringify({
  ...report,
  credentialSource: process.env.OANDA_TOKEN || process.env.OANDA_ACCOUNT_ID ? 'ENV' : (token && accountId ? 'LOCAL_SECRETS' : 'NONE'),
  secretExposed: false
}, null, 2));
