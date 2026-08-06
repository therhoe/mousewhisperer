import type { BillingPlan } from "@prisma/client";
import prisma from "../db.server";
import {
  PLAN_DISPLAY_NAMES,
  PLAN_LIMITS,
  SHOPIFY_PLAN_TO_BILLING_PLAN,
  type BillingLimits,
} from "./billing-plans";

export type BillingUsage = {
  storeSnapshots: number;
  normalSnapshots: number;
  abTests: number;
};

export type BillingAccess = {
  plan: BillingPlan;
  planName: string;
  isFree: boolean;
  isPaid: boolean;
  status: string;
  currentPeriodEnd: Date | null;
  usage: BillingUsage;
  limits: BillingLimits;
  canCreateStoreSnapshot: boolean;
  canCreateNormalSnapshot: boolean;
  canCreateAbTest: boolean;
};

export class PlanLimitError extends Error {
  code = "PLAN_LIMIT" as const;
  status = 402;

  constructor(message: string) {
    super(message);
    this.name = "PlanLimitError";
  }
}

export function isPlanLimitError(error: unknown): error is PlanLimitError {
  return error instanceof PlanLimitError;
}

export async function getBillingAccess(shop: string): Promise<BillingAccess> {
  const billing = await prisma.shopBilling.findUnique({ where: { shop } });
  const paidThrough =
    billing?.status === "ACTIVE" ||
    (billing?.status === "CANCELLED" &&
      Boolean(
        billing.currentPeriodEnd && billing.currentPeriodEnd > new Date(),
      ));

  const plan =
    billing && paidThrough ? billing.plan : ("FREE" as const);
  const limits = PLAN_LIMITS[plan];
  const [storeSnapshots, normalSnapshots, abTests] = await Promise.all([
    prisma.storeSnapshot.count({
      where: { shop },
    }),
    prisma.snapshot.count({
      where: {
        project: { shop },
      },
    }),
    prisma.abTest.count({
      where: { shop },
    }),
  ]);

  return {
    plan,
    planName: PLAN_DISPLAY_NAMES[plan],
    isFree: plan === "FREE",
    isPaid: plan !== "FREE",
    status: billing?.status || "FREE",
    currentPeriodEnd: billing?.currentPeriodEnd || null,
    usage: {
      storeSnapshots,
      normalSnapshots,
      abTests,
    },
    limits,
    canCreateStoreSnapshot: storeSnapshots < limits.storeSnapshots,
    canCreateNormalSnapshot: normalSnapshots < limits.normalSnapshots,
    canCreateAbTest: abTests < limits.abTests,
  };
}

export async function assertCanCreateStoreSnapshot(shop: string) {
  const access = await getBillingAccess(shop);
  if (!access.canCreateStoreSnapshot) {
    throw new PlanLimitError(
      `${access.planName} plan includes ${access.limits.storeSnapshots} store snapshot${access.limits.storeSnapshots === 1 ? "" : "s"}. Upgrade to run another store-wide snapshot.`,
    );
  }
  return access;
}

export async function assertCanCreateNormalSnapshots(
  shop: string,
  count = 1,
) {
  const access = await getBillingAccess(shop);
  if (access.usage.normalSnapshots + count > access.limits.normalSnapshots) {
    throw new PlanLimitError(
      `${access.planName} plan includes ${access.limits.normalSnapshots} audit snapshots. Upgrade to create more snapshots.`,
    );
  }
  return access;
}

export type ShopifyBillingSubscriptionLike = {
  id?: string | null;
  admin_graphql_api_id?: string | null;
  name?: string | null;
  planHandle?: string | null;
  status?: string | null;
  currentPeriodEnd?: string | Date | null;
  current_period_end?: string | Date | null;
};

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type PartnerActiveSubscription = {
  id?: string | null;
  billingPeriod?: string | null;
  cancelAtEndOfCycle?: boolean | null;
  currentBillingCycle?: {
    endTime?: string | null;
  } | null;
  items?: Array<{
    handle?: string | null;
    description?: string | null;
    price?: {
      active?: boolean | null;
    } | null;
  }> | null;
};

const SHOPIFY_APP_PRICING_QUERY = `#graphql
  query ActiveSubscription($appId: ID!, $shopId: ID!) {
    activeSubscription(appId: $appId, shopId: $shopId) {
      id
      billingPeriod
      cancelAtEndOfCycle
      currentBillingCycle {
        endTime
      }
      items {
        handle
        description
        price {
          active
        }
      }
    }
  }
`;

const SHOP_ID_QUERY = `#graphql
  query CurrentShopId {
    shop {
      id
    }
  }
`;

const LEGACY_ACTIVE_SUBSCRIPTIONS_QUERY = `#graphql
  query CurrentAppInstallationSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        currentPeriodEnd
      }
    }
  }
`;

export function billingPlanFromShopifyPlanName(name?: string | null) {
  if (!name) return null;
  const normalized = name.trim();
  return (
    SHOPIFY_PLAN_TO_BILLING_PLAN[normalized] ||
    SHOPIFY_PLAN_TO_BILLING_PLAN[normalized.toLowerCase()] ||
    null
  );
}

export async function syncShopBillingFromSubscription(
  shop: string,
  subscription: ShopifyBillingSubscriptionLike,
) {
  const plan =
    billingPlanFromShopifyPlanName(subscription.name) ||
    billingPlanFromShopifyPlanName(subscription.planHandle);
  if (!plan) return null;

  const rawPeriodEnd =
    subscription.currentPeriodEnd || subscription.current_period_end || null;
  const currentPeriodEnd = rawPeriodEnd ? new Date(rawPeriodEnd) : null;
  const status = subscription.status || "ACTIVE";
  const shopifySubscriptionId =
    subscription.id || subscription.admin_graphql_api_id || null;

  return prisma.shopBilling.upsert({
    where: { shop },
    create: {
      shop,
      plan,
      status,
      shopifySubscriptionId,
      currentPeriodEnd,
    },
    update: {
      plan,
      status,
      shopifySubscriptionId,
      currentPeriodEnd,
    },
  });
}

function shopifyAppPricingConfig() {
  const rawAppId = process.env.SHOPIFY_APP_GID || process.env.SHOPIFY_APP_ID;
  const organizationId =
    process.env.SHOPIFY_PARTNER_ORGANIZATION_ID ||
    process.env.SHOPIFY_PARTNER_ORG_ID;
  const accessToken =
    process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN ||
    process.env.SHOPIFY_PARTNER_API_TOKEN;

  if (!rawAppId || !organizationId || !accessToken) return null;

  const appId = rawAppId.startsWith("gid://")
    ? rawAppId
    : `gid://shopify/App/${rawAppId}`;

  return {
    appId,
    organizationId,
    accessToken,
  };
}

async function getShopGid(admin: AdminGraphqlClient) {
  const response = await admin.graphql(SHOP_ID_QUERY);
  const payload = await response.json();
  return payload?.data?.shop?.id as string | undefined;
}

async function partnerApiRequest<T>(
  query: string,
  variables: Record<string, unknown>,
) {
  const config = shopifyAppPricingConfig();
  if (!config) return null;

  const response = await fetch(
    `https://partners.shopify.com/${config.organizationId}/api/2026-07/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": config.accessToken,
      },
      body: JSON.stringify({
        query,
        variables: {
          appId: config.appId,
          ...variables,
        },
      }),
    },
  );

  const payload = (await response.json()) as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };

  if (!response.ok || payload.errors?.length) {
    const message =
      payload.errors?.map((error) => error.message).filter(Boolean).join("; ") ||
      `Partner API request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload.data || null;
}

function subscriptionPlanFromPartnerSubscription(
  subscription: PartnerActiveSubscription | null | undefined,
) {
  const activeItems = subscription?.items?.filter(
    (item) => item.price?.active !== false,
  );
  for (const item of activeItems || []) {
    const plan =
      billingPlanFromShopifyPlanName(item.handle) ||
      billingPlanFromShopifyPlanName(item.description);
    if (plan) {
      return {
        plan,
        handle: item.handle || item.description || null,
      };
    }
  }
  return null;
}

async function syncShopBillingFromShopifyAppPricing(
  admin: AdminGraphqlClient,
  shop: string,
) {
  if (!shopifyAppPricingConfig()) return null;

  const shopId = await getShopGid(admin);
  if (!shopId) return null;

  const data = await partnerApiRequest<{
    activeSubscription?: PartnerActiveSubscription | null;
  }>(SHOPIFY_APP_PRICING_QUERY, { shopId });

  const subscription = data?.activeSubscription || null;
  const mappedPlan = subscriptionPlanFromPartnerSubscription(subscription);
  if (!subscription || !mappedPlan) {
    return null;
  }

  return prisma.shopBilling.upsert({
    where: { shop },
    create: {
      shop,
      plan: mappedPlan.plan,
      status: "ACTIVE",
      shopifySubscriptionId: subscription.id || mappedPlan.handle,
      currentPeriodEnd: subscription.currentBillingCycle?.endTime
        ? new Date(subscription.currentBillingCycle.endTime)
        : null,
    },
    update: {
      plan: mappedPlan.plan,
      status: subscription.cancelAtEndOfCycle ? "CANCELLED" : "ACTIVE",
      shopifySubscriptionId: subscription.id || mappedPlan.handle,
      currentPeriodEnd: subscription.currentBillingCycle?.endTime
        ? new Date(subscription.currentBillingCycle.endTime)
        : null,
    },
  });
}

async function syncShopBillingFromLegacyBilling(
  admin: AdminGraphqlClient,
  shop: string,
) {
  const response = await admin.graphql(LEGACY_ACTIVE_SUBSCRIPTIONS_QUERY);
  const payload = await response.json();
  const subscriptions =
    payload?.data?.currentAppInstallation?.activeSubscriptions || [];
  const subscription = subscriptions.find(
    (candidate: ShopifyBillingSubscriptionLike) =>
      billingPlanFromShopifyPlanName(candidate.name),
  );

  if (!subscription) return null;
  return syncShopBillingFromSubscription(shop, subscription);
}

export async function reconcileShopBillingFromShopify(
  admin: AdminGraphqlClient,
  shop: string,
) {
  try {
    const appPricingBilling = await syncShopBillingFromShopifyAppPricing(
      admin,
      shop,
    );
    if (appPricingBilling) return appPricingBilling;
  } catch (error) {
    console.warn("[billing] Shopify App Pricing sync failed", {
      shop,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    return await syncShopBillingFromLegacyBilling(admin, shop);
  } catch (error) {
    console.warn("[billing] Legacy billing sync failed", {
      shop,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function assertCanCreateAbTest(shop: string) {
  const access = await getBillingAccess(shop);
  if (!access.canCreateAbTest) {
    throw new PlanLimitError(
      "A/B testing is available on a paid plan. Upgrade to create A/B tests.",
    );
  }
  return access;
}

export async function assertSnapshotTargetAllowed(
  shop: string,
  targetVisitors: number,
) {
  const access = await getBillingAccess(shop);
  if (targetVisitors > access.limits.maxSnapshotTargetVisitors) {
    throw new PlanLimitError(
      `Free plan supports snapshot targets up to ${access.limits.maxSnapshotTargetVisitors.toLocaleString()} visitors. Upgrade for higher thresholds.`,
    );
  }
  return access;
}

export function planLimitPayload(error: PlanLimitError) {
  return {
    error: error.message,
    code: error.code,
  };
}
