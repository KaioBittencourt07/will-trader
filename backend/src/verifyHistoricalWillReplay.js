import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyHistoricalWillReplayArtifact } from './runHistoricalWillReplay.js';

function parseArgs(argv) {
  let datasetId = null;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg !== '--dataset-id' || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error('ARGUMENT_INVALID');
    }
    datasetId = argv[++index];
  }
  if (!datasetId) throw new Error('HISTORICAL_DATASET_ID_REQUIRED');
  return { datasetId };
}

export function runHistoricalReplayVerificationCli({
  argv = process.argv.slice(2),
  stdout = (value) => process.stdout.write(value),
  stderr = (value) => process.stderr.write(value),
  outputDirectory
} = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    stderr(`HISTORICAL_REPLAY_VERIFY_ARGUMENT_ERROR:${String(error?.message || 'INVALID_ARGUMENT').slice(0, 100)}\n`);
    return 2;
  }
  if (options.help) {
    stdout('Uso: npm run market:verify-replay -- --dataset-id <ID>\nOffline: verifica hashes do dataset, relatório e manifestos.\n');
    return 0;
  }
  try {
    const result = verifyHistoricalWillReplayArtifact({
      datasetId: options.datasetId,
      ...(outputDirectory ? { outputDirectory } : {})
    });
    stdout(JSON.stringify(result, null, 2) + '\n');
    return result.valid ? 0 : 1;
  } catch (error) {
    stderr(`HISTORICAL_REPLAY_VERIFY_FAILED:${String(error?.message || 'UNKNOWN').slice(0, 120)}\n`);
    return 1;
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = runHistoricalReplayVerificationCli();
