import assert from 'node:assert/strict';
import test from 'node:test';
import { createManualExecutionGateway } from '../backend/src/execution/manualGateway.js';

test('Avalon gateway is manual-only and never exposes automated execution', () => {
  const gateway = createManualExecutionGateway({ brokerUrl: 'https://trader.example' });
  assert.equal(gateway.status().mode, 'MANUAL_ONLY');
  assert.equal(gateway.status().automated, false);
  assert.throws(() => gateway.createHandoff({ direction: 'WAIT', blocked: true }), /executáveis/);
  assert.equal(gateway.createHandoff({ asset: 'EUR/USD', direction: 'BUY', blocked: false }).instruction.direction, 'BUY');
});
