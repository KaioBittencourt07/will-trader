import assert from 'node:assert/strict';
import test from 'node:test';
import { createManualExecutionGateway } from '../backend/src/execution/manualGateway.js';

const clickTime = '2026-10-22T17:00:00.000Z';
const expiryTime = '2026-10-22T17:01:00.000Z';

function validSignal(overrides = {}) {
  return {
    asset: 'EUR/USD',
    direction: 'BUY',
    blocked: false,
    executable: true,
    clickTime,
    timing: {
      clickTime,
      validFrom: '2026-10-22T16:59:59.000Z',
      validUntil: '2026-10-22T17:00:03.000Z',
      expiryTime
    },
    ...overrides
  };
}

test('Avalon gateway is manual-only and never exposes automated execution', () => {
  const gateway = createManualExecutionGateway({ brokerUrl: 'https://trader.example' });
  assert.equal(gateway.status().mode, 'MANUAL_ONLY');
  assert.equal(gateway.status().automated, false);
});

test('creates a handoff only for executable signals inside the current timing window', () => {
  const gateway = createManualExecutionGateway({
    brokerUrl: 'https://trader.example',
    now: () => Date.parse('2026-10-22T17:00:00.000Z')
  });
  const result = gateway.createHandoff(validSignal());
  assert.equal(result.mode, 'MANUAL_ONLY');
  assert.equal(result.instruction.asset, 'EUR/USD');
  assert.equal(result.instruction.direction, 'BUY');
  assert.equal(result.instruction.clickTime, clickTime);
  assert.equal(result.instruction.expiryTime, expiryTime);
  assert.equal(result.instruction.expirySeconds, 60);
});

test('vetoes WAIT, blocked, and non-executable signals', () => {
  const gateway = createManualExecutionGateway({
    now: () => Date.parse('2026-10-22T17:00:00.000Z')
  });
  assert.throws(() => gateway.createHandoff(validSignal({ direction: 'WAIT', blocked: true })), /executáveis/);
  assert.throws(() => gateway.createHandoff(validSignal({ blocked: true })), /executáveis/);
  assert.throws(() => gateway.createHandoff(validSignal({ executable: false })), /executáveis/);
  assert.throws(() => gateway.createHandoff({ direction: 'BUY', blocked: false }), /executáveis/);
});

test('vetoes expired, early, inconsistent, or incomplete timing and invalid asset', () => {
  const now = Date.parse('2026-10-22T17:00:00.000Z');
  const gateway = createManualExecutionGateway({ now: () => now });
  assert.throws(() => gateway.createHandoff(validSignal({
    timing: { ...validSignal().timing, validUntil: '2026-10-22T16:59:59.000Z' }
  })), /expirada/);
  assert.throws(() => gateway.createHandoff(validSignal({
    timing: { ...validSignal().timing, validFrom: '2026-10-22T17:00:01.000Z' }
  })), /ainda não começou/);
  assert.throws(() => gateway.createHandoff(validSignal({ clickTime: 'invalid' })), /inconsistente/);
  assert.throws(() => gateway.createHandoff(validSignal({ asset: 'EUR/USD OTC' })), /Ativo ausente/);
  assert.throws(() => gateway.createHandoff(validSignal({
    timing: { ...validSignal().timing, expiryTime: null }
  })), /Expiração/);
});
