type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const cache = new Map<string, CacheEntry<unknown>>();

export const loaderCacheKeys = {
  dashboard: (shop: string) => `dashboard:${shop}`,
  abTestTemplates: (shop: string) => `ab-test-templates:${shop}`,
  category: (shop: string, category: string) => `category:${shop}:${category}`,
  categoryFast: (shop: string, category: string) =>
    `category-fast:${shop}:${category}`,
  categoryPrefix: (shop: string) => `category:${shop}:`,
  categoryFastPrefix: (shop: string) => `category-fast:${shop}:`,
  project: (shop: string, projectId: string) => `project:${shop}:${projectId}`,
};

export async function cachedValue<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const cached = cache.get(key) as CacheEntry<T> | undefined;
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = await load();
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

export function clearCacheKey(key: string) {
  cache.delete(key);
}

export function clearCachePrefix(prefix: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}
