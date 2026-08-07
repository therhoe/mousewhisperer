import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  BillingReplacementBehavior,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import type { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import prisma from "./db.server";
import { SIGNAL_PLAN, WHISPER_PLAN } from "./utils/billing-plans";

const SESSION_CACHE_TTL_MS = 5 * 60_000;

export function isShopifyBillingTestMode() {
  if (process.env.SHOPIFY_BILLING_TEST) {
    return process.env.SHOPIFY_BILLING_TEST === "true";
  }
  return process.env.NODE_ENV !== "production";
}

class CachedSessionStorage implements SessionStorage {
  private cache = new Map<string, { expiresAt: number; value: Session }>();
  private storage: SessionStorage;

  constructor(storage: SessionStorage) {
    this.storage = storage;
  }

  async storeSession(session: Session) {
    const stored = await this.storage.storeSession(session);
    if (stored) {
      this.cache.set(session.id, { value: session, expiresAt: Date.now() + SESSION_CACHE_TTL_MS });
    }
    return stored;
  }

  async loadSession(id: string) {
    const cached = this.cache.get(id);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const session = await this.storage.loadSession(id);
    if (session) {
      this.cache.set(id, { value: session, expiresAt: Date.now() + SESSION_CACHE_TTL_MS });
    } else {
      this.cache.delete(id);
    }
    return session;
  }

  async deleteSession(id: string) {
    const deleted = await this.storage.deleteSession(id);
    this.cache.delete(id);
    return deleted;
  }

  async deleteSessions(ids: string[]) {
    const deleted = await this.storage.deleteSessions(ids);
    ids.forEach((id) => this.cache.delete(id));
    return deleted;
  }

  async findSessionsByShop(shop: string) {
    const sessions = await this.storage.findSessionsByShop(shop);
    sessions.forEach((session) => {
      this.cache.set(session.id, { value: session, expiresAt: Date.now() + SESSION_CACHE_TTL_MS });
    });
    return sessions;
  }
}

const sessionStorage = new CachedSessionStorage(
  new PrismaSessionStorage(prisma, {
    connectionRetries: 1,
    connectionRetryIntervalMs: 250,
  }),
);

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage,
  distribution: AppDistribution.AppStore,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
  },
  billing: {
    [WHISPER_PLAN]: {
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
      lineItems: [
        {
          amount: 49.99,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
    [SIGNAL_PLAN]: {
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
      lineItems: [
        {
          amount: 99.99,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.January26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export { sessionStorage };
