#!/usr/bin/env node
/**
 * Offline integrity check for the Twelve Data provider.
 * This script never calls a market API and does not consume provider credits.
 * Run from the repository root: node scripts/verify-local-market-provider.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const provider = resolve(root, 'data/src/providers/twelveDataProvider.js');
const tests = resolve(root, 'tests/twelveDataProvider.test.js');

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

console.log('WILL TRADER — verificação local do provedor (offline)');
console.log('Nenhuma chamada externa será feita; nenhum crédito será consumido.\n');

if (!existsSync(provider)) {
  fail(`Arquivo do provedor não encontrado: ${provider}`);
} else {
  const size = statSync(provider).size;
  console.log(`Provedor encontrado: ${provider} (${size} bytes)`);
  const syntax = spawnSync(process.execPath, ['--check', provider], { encoding: 'utf8' });
  if (syntax.status !== 0) {
    fail('A sintaxe do provedor está inválida. Não inicie o backend até restaurar o arquivo completo.');
    if (syntax.stdout) console.error(syntax.stdout.trim());
    if (syntax.stderr) console.error(syntax.stderr.trim());
  } else {
    console.log('OK: sintaxe JavaScript válida.');
  }
}

if (!existsSync(tests)) {
  fail(`Arquivo de testes não encontrado: ${tests}`);
} else if (process.exitCode !== 1) {
  console.log('\nExecutando testes focados do provedor com mocks (sem API real)...');
  const testRun = spawnSync(process.execPath, ['--test', tests], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit'
  });
  if (testRun.status !== 0) {
    fail('Os testes focados do provedor falharam.');
  } else {
    console.log('\nOK: testes focados do provedor passaram.');
  }
}

if (process.exitCode === 1) {
  console.error('\nResultado: NÃO APROVADO. Corrija a cópia local antes de iniciar o backend.');
} else {
  console.log('\nResultado: APROVADO para sintaxe e testes focados offline. Isso não comprova conexão com feed real nem rentabilidade.');
}
