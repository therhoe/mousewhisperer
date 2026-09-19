import { getDashboardAbTestActivity } from "./dashboard-activity.server";
import { cachedValue, clearCacheKey } from "./loader-cache.server";

const activityCacheKey = (shop: string) => `ab-test-activity:${shop}`;

export function getCachedAbTestActivity(shop: string) {
  return cachedValue(activityCacheKey(shop), 60_000, () =>
    getDashboardAbTestActivity(shop),
  );
}

export function clearAbTestActivityCache(shop: string) {
  clearCacheKey(activityCacheKey(shop));
}
