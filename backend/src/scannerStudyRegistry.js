export const SCANNER_STUDY_REGISTRY_VERSION = 'scanner-study-registry-v1';
const CANONICAL_FINGERPRINT_VERSION = 'canonical-study-fingerprint-v1';

export function createScannerStudyRegistry({ maxEntries = 5000, now = () => Date.now() } = {}) {
  const seen = new Map();
  const limit = Math.max(100, Number(maxEntries) || 5000);
  let hydratedEntries = 0;

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
      latestClosedCandleTimestamp: metadata.latestClosedCandleTimestamp ?? null,
      hydrated: false
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

  function hydrate(records = []) {
    let loaded = 0;
    let ignored = 0;
    for (const record of Array.isArray(records) ? records : []) {
      const canonicalStudy = record?.metadata?.context?.canonicalStudy ?? record?.metadata?.canonicalStudy ?? null;
      const fingerprint = canonicalStudy?.fingerprint ?? null;
      const hash = typeof fingerprint?.hash === 'string' && fingerprint.hash.trim() ? fingerprint.hash.trim() : null;
      if (!hash || fingerprint?.version !== CANONICAL_FINGERPRINT_VERSION) {
        ignored += 1;
        continue;
      }
      if (seen.has(hash)) continue;

      const firstSeenCandidate = canonicalStudy?.dedup?.firstSeenAt ?? record?.createdAt ?? null;
      const firstSeenAt = Number.isFinite(Date.parse(firstSeenCandidate ?? ''))
        ? new Date(Date.parse(firstSeenCandidate)).toISOString()
        : new Date(now()).toISOString();

      seen.set(hash, Object.freeze({
        firstSeenAt,
        asset: record?.asset ?? null,
        timeframe: record?.timeframe ?? null,
        latestClosedCandleTimestamp: canonicalStudy?.latestClosedCandleTimestamp ?? null,
        hydrated: true
      }));
      loaded += 1;
    }
    compact();
    hydratedEntries += loaded;
    return Object.freeze({
      version: SCANNER_STUDY_REGISTRY_VERSION,
      loaded,
      ignored,
      size: seen.size,
      maxEntries: limit
    });
  }

  function snapshot() {
    return Object.freeze({
      version: SCANNER_STUDY_REGISTRY_VERSION,
      size: seen.size,
      maxEntries: limit,
      hydratedEntries
    });
  }

  function clear() {
    seen.clear();
    hydratedEntries = 0;
  }

  return Object.freeze({ claim, hydrate, snapshot, clear });
}

export const scannerStudyRegistry = createScannerStudyRegistry();
