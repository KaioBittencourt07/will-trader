export const COMPOSITE_MACRO_SOURCE = 'BLS_PLUS_FED_OFFICIAL_MACRO';

function uniqueEvents(events = []) {
  const seen = new Set();
  const merged = [];
  for (const event of events) {
    const key = `${event?.name ?? ''}|${event?.currency ?? ''}|${event?.timestamp ?? ''}|${event?.source ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...event });
  }
  return merged.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

export function createCompositeMacroAdapter({
  adapters = [],
  now = () => Date.now(),
  cacheTtlMs = 10 * 60_000
} = {}) {
  const required = (Array.isArray(adapters) ? adapters : []).filter((adapter) => adapter?.getSnapshot);
  let cache = null;

  return Object.freeze({
    source: COMPOSITE_MACRO_SOURCE,
    async getSnapshot() {
      const current = now();
      if (cache && current - cache.cachedAtMs <= cacheTtlMs) return structuredClone(cache.snapshot);
      if (!required.length) throw new Error('COMPOSITE_MACRO_NO_ADAPTERS');

      const settled = await Promise.allSettled(required.map((adapter) => adapter.getSnapshot()));
      const failed = settled
        .map((result, index) => ({ result, adapter: required[index] }))
        .filter(({ result }) => result.status === 'rejected');

      // Required official macro sources are an all-or-nothing evidence set.
      // A missing source must never be interpreted as LOW macro risk.
      if (failed.length) {
        const sources = failed.map(({ adapter }) => adapter.source ?? 'UNKNOWN').join(',');
        throw new Error(`COMPOSITE_MACRO_REQUIRED_SOURCE_UNAVAILABLE:${sources}`);
      }

      const snapshots = settled.map((result) => result.value);
      const events = uniqueEvents(snapshots.flatMap((snapshot) => Array.isArray(snapshot?.events) ? snapshot.events : []));
      if (!events.length) throw new Error('COMPOSITE_MACRO_NO_EVENTS');

      const fetchedTimes = snapshots
        .map((snapshot) => Date.parse(snapshot?.fetchedAt ?? ''))
        .filter(Number.isFinite);
      if (fetchedTimes.length !== snapshots.length) throw new Error('COMPOSITE_MACRO_FETCH_TIME_UNVERIFIED');

      // Use the oldest constituent fetch time so freshness cannot be overstated.
      const fetchedAt = new Date(Math.min(...fetchedTimes)).toISOString();
      const snapshot = {
        source: COMPOSITE_MACRO_SOURCE,
        fetchedAt,
        events,
        sources: snapshots.map((snapshot) => snapshot.source ?? null),
        completeness: 'ALL_REQUIRED_SOURCES_PRESENT'
      };
      cache = { cachedAtMs: current, snapshot };
      return structuredClone(snapshot);
    },
    health() {
      return {
        source: COMPOSITE_MACRO_SOURCE,
        requiredSources: required.map((adapter) => adapter.source ?? 'UNKNOWN'),
        cacheTtlMs,
        cached: Boolean(cache),
        cachedFetchedAt: cache?.snapshot?.fetchedAt ?? null
      };
    }
  });
}
