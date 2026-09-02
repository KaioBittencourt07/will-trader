import assert from 'node:assert/strict';
import test from 'node:test';
import { attributeOutcome, ERROR_CAUSES } from '../learning/src/errorAttribution.js';

test('loss alone remains unknown while persisted timing and data evidence are attributable', () => {
  assert.equal(attributeOutcome({ outcome: 'LOSS' }).primaryCause, ERROR_CAUSES.UNKNOWN);
  const timing = attributeOutcome({ outcome: 'LOSS', metadata: { timing: { reasons: ['LATE_ENTRY', 'VOLATILITY_SPIKE'] } } });
  assert.equal(timing.primaryCause, ERROR_CAUSES.LATE_ENTRY);
  assert.ok(timing.contributingCauses.includes(ERROR_CAUSES.VOLATILITY_SPIKE));
  assert.equal(attributeOutcome({ outcome: 'DATA_INVALID', metadata: { dataQuality: { valid: false } } }).primaryCause, ERROR_CAUSES.DATA_ERROR);
});
