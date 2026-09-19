type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const cache = new Map<string, CacheEntry<unknown>>();
const pendingLoads = new Map<string, Promise<unknown>>();
const MAX_CACHE_ENTRIES = 500;

export const loaderCacheKeys = {
  dashboard: (shop: string) => `dashboard:${shop}`,
  abTestTemplates: (shop: string) => `ab-test-templates:${shop}`,
  category: (shop: string, category: string) => `category:${shop}:${category}`,
  categoryFast: (shop: string, category: string) =>
    `category-fast:${shop}:${category}`,
  categoryPrefix: (shop: string) => `category:${shop}:`,
  categoryFastPrefix: (shop: string) => `category-fast:${shop}:`,
  project: (shop: string, projectId: string) => `project:${shop}:${projectId}`,
  billingDisplay: (shop: string) => `billing-display:${shop}`,
  billingSync: (shop: string) => `billing-sync:${shop}`,
};

export async function cachedValue<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const cached = cache.get(key) as CacheEntry<T> | undefined;
  if (cached && cached.expiresAt > Date.now()) {
    // Keep the frequently visited shells when the process cache is full.
    cache.delete(key);
    cache.set(key, cached);
    return cached.value;
  }
  cache.delete(key);
  const pending = pendingLoads.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  // Navigation, prefetch and fetcher requests often arrive together. They must
  // share the same cold query instead of each occupying a database connection.
  const loading = Promise.resolve().then(load);
  pendingLoads.set(key, loading);
  try {
    const value = await loading;
    // A mutation may have invalidated this key while the query was in flight.
    // Never put that older result back over the post-mutation cache.
    if (pendingLoads.get(key) === loading && ttlMs > 0) {
      if (cache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) cache.delete(oldestKey);
      }
      cache.set(key, { value, expiresAt: Date.now() + ttlMs });
    }
    return value;
  } finally {
    // Rejections are not cached, and an old completion cannot clear a new load.
    if (pendingLoads.get(key) === loading) pendingLoads.delete(key);
  }
}

export function clearCacheKey(key: string) {
  cache.delete(key);
  pendingLoads.delete(key);
}

export function clearCachePrefix(prefix: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
  for (const key of pendingLoads.keys()) {
    if (key.startsWith(prefix)) pendingLoads.delete(key);
  }
}
