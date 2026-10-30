import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOpenAIShadowCommissionFixture,
  runOpenAIShadowCommissioning
} from './commissionOpenAIShadowReadOnly.js';

test('builds a synthetic non-trading shadow fixture', () => {
  const fixture = buildOpenAIShadowCommissionFixture();
  assert.equal(fixture.fixture, true);
  assert.equal(fixture.executionAllowed, false);
  assert.equal(fixture.deterministicDecision.direction, 'SELL');
  assert.ok(fixture.instructions.includes('NO_ORDER_EXECUTION'));
});

test('does not attempt OpenAI when the credential is absent', async () => {
  let calls = 0;
  const result = await runOpenAIShadowCommissioning({
    apiKeyConfigured: false,
    analyze: async () => {
      calls += 1;
      throw new Error('must not run');
    }
  });

  assert.equal(calls, 0);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.requestsMade, 0);
  assert.equal(result.failure, 'OPENAI_API_KEY_NOT_CONFIGURED');
  assert.equal(result.decisionImpact, 'NONE');
  assert.equal(result.ordersExecuted, 0);
});

test('approves one bounded schema-valid confirming review', async () => {
  let calls = 0;
  const result = await runOpenAIShadowCommissioning({
    apiKeyConfigured: true,
    analyze: async () => {
      calls += 1;
      return {
        direction: 'SELL',
        score: 77,
        confidence: 73,
        thesis: 'Synthetic review only.',
        confirmations: ['fixture'],
        risks: ['news unknown'],
        block: false
      };
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.requestBudget, 1);
  assert.equal(result.requestsMade, 1);
  assert.equal(result.status, 'APPROVED');
  assert.equal(result.schemaApproved, true);
  assert.equal(result.semanticApproved, true);
  assert.equal(result.automatedBrokerExecution, false);
  assert.equal(result.ordersExecuted, 0);
});

test('allows WAIT as a shadow veto/abstention', async () => {
  const result = await runOpenAIShadowCommissioning({
    apiKeyConfigured: true,
    analyze: async () => ({
      direction: 'WAIT',
      score: 40,
      confidence: 52,
      thesis: 'Insufficient evidence.',
      confirmations: [],
      risks: ['unknown context'],
      block: true
    })
  });

  assert.equal(result.status, 'APPROVED');
  assert.equal(result.semanticApproved, true);
});

test('blocks an opposite-direction shadow response', async () => {
  const result = await runOpenAIShadowCommissioning({
    apiKeyConfigured: true,
    analyze: async () => ({
      direction: 'BUY',
      score: 90,
      confidence: 90,
      thesis: 'Opposite direction.',
      confirmations: [],
      risks: [],
      block: false
    })
  });

  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.schemaApproved, true);
  assert.equal(result.semanticApproved, false);
  assert.equal(result.failure, 'OPENAI_SHADOW_DIRECTION_BOUNDARY_VIOLATION');
});

test('does not retry inside the commissioning wrapper after an error', async () => {
  let calls = 0;
  const result = await runOpenAIShadowCommissioning({
    apiKeyConfigured: true,
    analyze: async () => {
      calls += 1;
      throw Object.assign(new Error('synthetic'), { name: 'SyntheticProviderError' });
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.requestsMade, 1);
  assert.equal(result.failure, 'SyntheticProviderError');
});
