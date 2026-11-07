import type { Session } from "@shopify/shopify-api";

// Shopify retires non-expiring offline access tokens for public apps: new installs
// are blocked from 2027-01-01 and Admin API requests with them are rejected from
// 2027-04-01. With `future.expiringOfflineAccessTokens`, new token exchanges already
// return expiring tokens and the library refreshes them. A store that still holds
// a working old token never gets a new exchange, so it is upgraded here. The
// upgrade invalidates the old token at once; for seven days Shopify returns the
// same expiring token for it again, so a lost save is recovered on the next try.

type OfflineSession = Pick<Session, "shop" | "isOnline" | "accessToken" | "expires">;

export function hasNonExpiringOfflineToken(session: OfflineSession) {
  return !session.isOnline && !session.expires && Boolean(session.accessToken);
}

type MigrateToExpiringToken = (params: {
  shop: string;
  nonExpiringOfflineAccessToken: string;
}) => Promise<{ session: Session }>;

type Log = {
  info(message: string, details: Record<string, unknown>): void;
  warn(message: string, details: Record<string, unknown>): void;
};

export function createOfflineTokenMigrator({
  migrate,
  storage,
  log = console,
}: {
  migrate: MigrateToExpiringToken;
  storage: { storeSession(session: Session): Promise<boolean> };
  log?: Log;
}) {
  // One upgrade per store at a time in this process: a second exchange of the
  // same old token would only repeat the first.
  const pending = new Map<string, Promise<Session | null>>();

  return async function ensureExpiringOfflineToken<T extends OfflineSession>(
    session: T,
  ): Promise<T | Session> {
    if (!hasNonExpiringOfflineToken(session)) return session;
    const { shop } = session;
    let upgrade = pending.get(shop);
    if (!upgrade) {
      upgrade = (async () => {
        try {
          const { session: expiring } = await migrate({
            shop,
            nonExpiringOfflineAccessToken: session.accessToken as string,
          });
          await storage.storeSession(expiring);
          log.info("[MW Auth] Offline token upgraded to an expiring token", { shop });
          return expiring;
        } catch (error) {
          log.warn("[MW Auth] Offline token upgrade failed", {
            shop,
            error: error instanceof Error ? error.name : "UnknownError",
            status: (error as { response?: { code?: number } })?.response?.code ?? null,
          });
          return null;
        } finally {
          pending.delete(shop);
        }
      })();
      pending.set(shop, upgrade);
    }
    return (await upgrade) ?? session;
  };
}
