import { splitChronologically } from './marketValidation.js';

/**
 * Backward-compatible names with strict chronological and same-timestamp grouping.
 * Use embargoMs at least as large as the maximum outcome/expiry label horizon.
 */
export function timeSplit(records = [], { train = 0.6, validation = 0.2, embargoMs = 0 } = {}) {
  const split = splitChronologically(records, {
    trainRatio: train,
    validationRatio: validation,
    embargoMs,
    timestampField: 'timestamp'
  });
  return { train: split.train, validation: split.validation, test: split.test };
}
