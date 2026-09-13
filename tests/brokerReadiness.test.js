import assert from 'node:assert/strict';
import test from 'node:test';
import { brokerReadiness } from '../backend/src/execution/brokerReadiness.js';

test('broker readiness never enables live execution from credentials alone', () => {
  const status = brokerReadiness({ OANDA_ACCESS_TOKEN: 'token', OANDA_ACCOUNT_ID: 'account' });
  assert.equal(status.candidates.find((item) => item.broker === 'OANDA').mode, 'PAPER_READY');
  assert.equal(status.liveExecutionEnabled, false);
});
