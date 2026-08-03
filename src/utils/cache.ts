// A tiny in-memory TTL cache used to avoid re-hitting the market data API for
// data we fetched moments ago. Deliberately dependency free.
//
// Expired entries are kept rather than dropped, so that when the daily request
// budget is exhausted we can still serve the last known value and mark it
// stale. Eviction is by capacity only.
//
// Caveats worth knowing before relying on this:
//   - It lives in the process, so it is emptied on every restart/redeploy.
//   - It is per-instance: running multiple replicas gives each its own copy,
//     so the effective upstream request rate scales with instance count.
// Both are acceptable for a single small server; moving to Redis or the
// existing Postgres `stocks` table would fix them.

interface CacheEntry {
  value: unknown;   // The cached payload
  expiresAt: number; // Epoch milliseconds after which the entry is stale
}

// Insertion-ordered map, which lets us evict the oldest entry cheaply.
const store = new Map<string, CacheEntry>();

// Upper bound on entries so a flood of distinct tickers cannot grow the
// process heap without limit.
const MAX_ENTRIES = 500;

// Move a key to the newest position so recently used entries survive eviction.
const touch = (key: string, entry: CacheEntry) => {
  store.delete(key);
  store.set(key, entry);
};

// Look up a value that is still within its TTL.
export const getCached = <T>(key: string): T | undefined => {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) return undefined; // stale, but retained
  touch(key, entry);
  return entry.value as T;
};

// Look up a value regardless of age. Used as the fallback when the daily
// request budget is gone: a stale price beats no price at all.
export const getCachedStale = <T>(key: string): { value: T; age: number } | undefined => {
  const entry = store.get(key);
  if (!entry) return undefined;
  touch(key, entry);
  return {
    value: entry.value as T,
    age: Math.max(0, Date.now() - entry.expiresAt),
  };
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
