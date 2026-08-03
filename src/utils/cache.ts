// A tiny in-memory TTL cache used to avoid re-hitting Polygon.io for data we
// fetched moments ago. Deliberately dependency free.
//
// Caveats worth knowing before relying on this:
//   - It lives in the process, so it is emptied on every restart/redeploy.
//   - It is per-instance: running multiple dynos/replicas gives each its own
//     copy, so the effective upstream request rate scales with instance count.
// Both are acceptable for a single small server; moving to Redis or the
// existing Postgres `stocks` table would fix them.

interface CacheEntry {
  value: unknown;   // The cached payload (a parsed Polygon response)
  expiresAt: number; // Epoch milliseconds after which the entry is stale
}

// Insertion-ordered map, which lets us evict the oldest entry cheaply.
const store = new Map<string, CacheEntry>();

// Upper bound on entries so a flood of distinct tickers cannot grow the
// process heap without limit.
const MAX_ENTRIES = 500;

// Look up a cached value. Expired entries are dropped and reported as a miss.
export const getCached = <T>(key: string): T | undefined => {
  const entry = store.get(key);
  if (!entry) return undefined;

  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }

  // Re-insert so recently read keys sort as newest and survive eviction.
  store.delete(key);
  store.set(key, entry);
  return entry.value as T;
};

// Store a value under the given key for ttlMs milliseconds.
export const setCached = (key: string, value: unknown, ttlMs: number): void => {
  // Evict the least recently used entry once we are at capacity.
  if (!store.has(key) && store.size >= MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (oldestKey !== undefined) store.delete(oldestKey);
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
};

// Exposed for tests and diagnostics.
export const clearCache = (): void => {
  store.clear();
};
