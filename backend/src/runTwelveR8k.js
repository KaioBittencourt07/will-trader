import 'dotenv/config';
import { runTwelveR8kExecution } from './twelveR8kExecution.js';

const RUNNER_WATCHDOG_MS = 70_000;

const watchdog = new Promise((resolve) => {
  const timer = setTimeout(() => resolve(Object.freeze({
    executionVersion: 'twelve-r8k-execution-v1',
    result: 'INCONCLUSIVE',
    reasonCodes: Object.freeze(['R8K_RUNNER_WATCHDOG_EXPIRED']),
    freshnessContractMs: 30_000,
    freshnessContractChanged: false,
    timestampSemantics: 'UNVERIFIED',
    providerCommissioning: false,
    decisionImpact: 'NONE',
    prospectivePaperAuthorized: false,
    ordersExecuted: 0,
    externalProviderCalls: 'UNKNOWN_AFTER_STARTED_ATTEMPT',
    secretExposed: false
  })), RUNNER_WATCHDOG_MS);
  timer.unref?.();
});

const result = await Promise.race([
  runTwelveR8kExecution(),
  watchdog
]);

console.log(JSON.stringify(result, null, 2));
process.exitCode = result?.result === 'OBSERVED' ? 0 : 2;
setTimeout(() => process.exit(process.exitCode ?? 2), 25).unref?.();
