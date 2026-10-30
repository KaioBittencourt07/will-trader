import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateTwelveWsEventFreshness } from '../backend/src/twelveWsEventFreshness.js';
import { evaluateTwelveWsCommissioningReadiness } from '../backend/src/twelveWsCommissioningReadiness.js';

const input = (ageMs) => ({ eventTimestamp: 1_800_000_000_000, eventTimestampUnit: 'UNIX_MILLISECONDS', receiveTimestamp: 1_800_000_000_000 + ageMs, receiveTimestampUnit: 'UNIX_MILLISECONDS' });
test('valid age below and at the inclusive 30-second contract passes locally', () => {
  assert.equal(evaluateTwelveWsEventFreshness(input(29_999)).freshnessGate, 'PASS');
  const boundary = evaluateTwelveWsEventFreshness(input(30_000)); assert.equal(boundary.freshnessGate, 'PASS'); assert.equal(boundary.eventAgeMs, 30_000);
});
test('age above 30 seconds fails the frozen contract', () => {
  const report = evaluateTwelveWsEventFreshness(input(30_001)); assert.equal(report.freshnessGate, 'FAIL'); assert.equal(report.blocker, 'EVENT_OLDER_THAN_FROZEN_CONTRACT');
});
test('missing event or receive timestamp is unverified', () => {
  assert.equal(evaluateTwelveWsEventFreshness({ receiveTimestamp: 1, receiveTimestampUnit: 'UNIX_MILLISECONDS' }).freshnessGate, 'UNVERIFIED');
  assert.equal(evaluateTwelveWsEventFreshness({ eventTimestamp: 1, eventTimestampUnit: 'UNIX_MILLISECONDS' }).freshnessGate, 'UNVERIFIED');
});
test('invalid numeric values and ambiguous units fail closed', () => {
  assert.equal(evaluateTwelveWsEventFreshness({ ...input(0), eventTimestamp: 'no' }).freshnessGate, 'DATA_INVALID');
  assert.equal(evaluateTwelveWsEventFreshness({ eventTimestamp: 1_800_000_000, receiveTimestamp: 1_800_000_001_000, receiveTimestampUnit: 'UNIX_MILLISECONDS' }).timestampUnitGate, 'FAIL');
});
test('future timestamp fails with zero tolerance and is never clamped', () => {
  const report = evaluateTwelveWsEventFreshness(input(-1)); assert.equal(report.freshnessGate, 'DATA_INVALID'); assert.equal(report.futureTimestampGate, 'FAIL'); assert.equal(report.eventAgeMs, null);
});
test('seconds-to-milliseconds conversion is explicit and versioned', () => {
  const report = evaluateTwelveWsEventFreshness({ eventTimestamp: 1_800_000_000, eventTimestampUnit: 'UNIX_SECONDS', receiveTimestamp: 1_800_000_001_000, receiveTimestampUnit: 'UNIX_MILLISECONDS' });
  assert.equal(report.eventAgeMs, 1_000); assert.equal(report.timestampUnitGate, 'PASS');
});
test('output is allowlisted and excludes absolute timestamps and secrets', () => {
  const report = evaluateTwelveWsEventFreshness(input(1000)); const text = JSON.stringify(report);
  assert.equal(text.includes('1800000000000'), false); assert.equal('eventTimestamp' in report, false); assert.equal('receiveTimestamp' in report, false); assert.equal('price' in report, false); assert.equal('apiKey' in report, false);
});
test('raw or secret-bearing input fails closed without echoing values', () => {
  const report = evaluateTwelveWsEventFreshness({ ...input(1000), price: 1.2, apiKey: 'SYNTHETIC_SECRET' });
  assert.equal(report.freshnessGate, 'DATA_INVALID'); assert.equal(report.blocker, 'UNSANITIZED_INPUT'); assert.equal(JSON.stringify(report).includes('SYNTHETIC_SECRET'), false);
});
test('one freshness PASS cannot commission or authorize PAPER', () => {
  const freshness = evaluateTwelveWsEventFreshness(input(1000)); const readiness = evaluateTwelveWsCommissioningReadiness([], freshness);
  assert.equal(readiness.freshnessCompatibilityGate, 'PASS'); assert.equal(readiness.providerCommissioning, false); assert.equal(readiness.prospectivePaperAuthorized, false); assert.equal(readiness.ordersExecuted, 0);
});
