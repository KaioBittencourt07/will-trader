export const SCANNER_STUDY_REGISTRY_VERSION = 'scanner-study-registry-v1';

export function createScannerStudyRegistry({ maxEntries = 5000, now = () => Date.now() } = {}) {
  const seen = new Map();
  const limit = Math.max(100, Number(maxEntries) || 5000);

  function compact() {
    while (seen.size > limit) {
      const oldest = seen.keys().next().value;
      if (oldest === undefined) break;
      seen.delete(oldest);
    }
  }

  function claim(fingerprint, metadata = {}) {
    const hash = fingerprint?.eligible === true ? fingerprint.hash : null;
    if (!hash) {
      return Object.freeze({
        version: SCANNER_STUDY_REGISTRY_VERSION,
        accepted: false,
        duplicate: false,
        reason: 'STUDY_FINGERPRINT_NOT_ELIGIBLE',
        hash: null
      });
    }

    const existing = seen.get(hash);
    if (existing) {
      return Object.freeze({
        version: SCANNER_STUDY_REGISTRY_VERSION,
        accepted: false,
        duplicate: true,
        reason: 'DUPLICATE_CANONICAL_STUDY',
        hash,
        firstSeenAt: existing.firstSeenAt,
        latestClosedCandleTimestamp: existing.latestClosedCandleTimestamp ?? null
      });
    }

    const firstSeenAt = new Date(now()).toISOString();
    seen.set(hash, Object.freeze({
      firstSeenAt,
      asset: metadata.asset ?? null,
      timeframe: metadata.timeframe ?? null,
      latestClosedCandleTimestamp: metadata.latestClosedCandleTimestamp ?? null
    }));
    compact();

    return Object.freeze({
      version: SCANNER_STUDY_REGISTRY_VERSION,
      accepted: true,
      duplicate: false,
      reason: null,
      hash,
      firstSeenAt
    });
  }

  function snapshot() {
    return Object.freeze({
      version: SCANNER_STUDY_REGISTRY_VERSION,
      size: seen.size,
      maxEntries: limit
    });
  }

  function clear() {
    seen.clear();
  }

  return Object.freeze({ claim, snapshot, clear });
}

export const scannerStudyRegistry = createScannerStudyRegistry();
