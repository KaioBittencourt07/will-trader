import assert from 'node:assert/strict';
import test from 'node:test';
import { createScannerStudyRegistry } from '../backend/src/scannerStudyRegistry.js';

const fp = (hash = 'abc') => ({ eligible: true, hash });

test('accepts a canonical study once and rejects exact duplicate afterwards', () => {
  const registry = createScannerStudyRegistry({ maxEntries: 100, now: () => Date.parse('2026-09-14T12:00:00Z') });
  const first = registry.claim(fp('same'), { asset: 'EUR/USD', timeframe: '1min', latestClosedCandleTimestamp: '2026-09-14T11:59:00Z' });
  const second = registry.claim(fp('same'), { asset: 'EUR/USD', timeframe: '1min', latestClosedCandleTimestamp: '2026-09-14T11:59:00Z' });
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.reason, 'DUPLICATE_CANONICAL_STUDY');
});

test('different canonical fingerprints remain independent studies', () => {
  const registry = createScannerStudyRegistry();
  assert.equal(registry.claim(fp('a')).accepted, true);
  assert.equal(registry.claim(fp('b')).accepted, true);
  assert.equal(registry.snapshot().size, 2);
});

test('ineligible fingerprints fail closed and never enter registry', () => {
  const registry = createScannerStudyRegistry();
  const result = registry.claim({ eligible: false, hash: null });
  assert.equal(result.accepted, false);
  assert.equal(result.duplicate, false);
  assert.equal(result.reason, 'STUDY_FINGERPRINT_NOT_ELIGIBLE');
  assert.equal(registry.snapshot().size, 0);
});

test('hydrates canonical fingerprints from persistent history and preserves dedup across restart', () => {
  const registry = createScannerStudyRegistry({ maxEntries: 100, now: () => Date.parse('2026-09-14T12:10:00Z') });
  const hydration = registry.hydrate([
    {
      asset: 'EUR/USD',
      timeframe: '1min',
      createdAt: '2026-09-14T12:00:00.000Z',
      metadata: {
        context: {
          canonicalStudy: {
            latestClosedCandleTimestamp: '2026-09-14T11:59:00.000Z',
            fingerprint: { version: 'canonical-study-fingerprint-v1', hash: 'persisted-hash' },
            dedup: { firstSeenAt: '2026-09-14T12:00:00.000Z' }
          }
        }
      }
    },
    {
      asset: 'BTC/USD',
      metadata: { context: { canonicalStudy: { fingerprint: { version: 'legacy', hash: 'ignored-hash' } } } }
    }
  ]);

  assert.equal(hydration.loaded, 1);
  assert.equal(hydration.ignored, 1);
  assert.equal(registry.snapshot().hydratedEntries, 1);
  assert.equal(registry.snapshot().size, 1);

  const duplicate = registry.claim(fp('persisted-hash'));
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.reason, 'DUPLICATE_CANONICAL_STUDY');
  assert.equal(duplicate.firstSeenAt, '2026-09-14T12:00:00.000Z');

  assert.equal(registry.claim(fp('new-hash')).accepted, true);
  assert.equal(registry.snapshot().size, 2);
});
