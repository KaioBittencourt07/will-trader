import { resolveOutcome, buildLearningSignal } from './outcome.js';
import { summarize } from './statistics.js';

export function learnFromOutcome(record, outcome, metadata = {}, history = []) {
  const resolved = resolveOutcome(record, outcome, metadata);
  const signal = buildLearningSignal(resolved);
  const updatedHistory = [...history, resolved];
  return { record: resolved, learningSignal: signal, statistics: summarize(updatedHistory) };
}
