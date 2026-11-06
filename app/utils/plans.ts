import {
  PLAN_LIMITS,
  SIGNAL_PLAN,
  WHISPER_PLAN,
  type BillingLimits,
  type BillingPlanCode,
} from "./billing-plans";
import { safeReturnTo } from "./navigation";

export type PricingPlan = {
  shopifyPlan: string;
  billingPlan: "WHISPER" | "SIGNAL";
  name: string;
  tagline: string;
  price: string;
  compareAt: string;
  recommended: boolean;
  limits: BillingLimits;
};

// Prices and limits are unchanged by the redesign (spec section 2).
export const PRICING_PLANS: readonly PricingPlan[] = [
  {
    shopifyPlan: WHISPER_PLAN,
    billingPlan: "WHISPER",
    name: "Whisper",
    tagline: "For stores moving from first audits into repeat page testing.",
    price: "$49.99",
    compareAt: "$79",
    recommended: false,
    limits: PLAN_LIMITS.WHISPER,
  },
  {
    shopifyPlan: SIGNAL_PLAN,
    billingPlan: "SIGNAL",
    name: "Signal",
    tagline: "For teams using Snapshot as a decision engine.",
    price: "$99.99",
    compareAt: "$149",
    recommended: true,
    limits: PLAN_LIMITS.SIGNAL,
  },
];

const PLAN_RANK: Record<BillingPlanCode, number> = {
  FREE: 0,
  WHISPER: 1,
  STARTER: 1,
  SIGNAL: 2,
  GROWTH: 3,
  PRO: 4,
};

/** "upgrade" when `target` is above the current plan, otherwise "switch". */
export function planChange(current: string, target: BillingPlanCode): "upgrade" | "switch" {
  const from = PLAN_RANK[current as BillingPlanCode] ?? 0;
  return PLAN_RANK[target] > from ? "upgrade" : "switch";
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const RETURN_KEY = "snapshot_plans_return:";
const RETURN_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Leaves for Shopify's plan page after noting the screen to come back to.
 * Runs inside the click handler, so the top-level navigation keeps the
 * merchant's click (browsers block it after an async gap).
 */
export function startUpgrade({
  storage,
  shop,
  returnTo,
  url,
  open,
  now = Date.now(),
}: {
  storage: StorageLike | null;
  shop: string;
  returnTo: string | null;
  url: string;
  open: (url: string, target: string) => unknown;
  now?: number;
}) {
  const path = safeReturnTo(returnTo);
  try {
    if (storage && path) storage.setItem(RETURN_KEY + shop, JSON.stringify({ path, at: now }));
    else storage?.removeItem(RETURN_KEY + shop);
  } catch {
    // Storage is optional: without it the merchant lands on Plans (spec 4.4).
  }
  open(url, "_top");
}

/**
 * After Shopify's plan page: the screen to return to when billing was
 * approved, otherwise null. Either outcome forgets the saved screen; an
 * ordinary visit (no `billing` param) leaves it alone.
 */
export function finishUpgrade({
  storage,
  shop,
  billing,
  now = Date.now(),
}: {
  storage: StorageLike | null;
  shop: string;
  billing: string | null;
  now?: number;
}): string | null {
  if (billing !== "approved" && billing !== "not-approved") return null;
  try {
    const raw = storage?.getItem(RETURN_KEY + shop) ?? null;
    storage?.removeItem(RETURN_KEY + shop);
    if (billing !== "approved" || !raw) return null;
    const saved = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof saved.at !== "number" || saved.at > now || now - saved.at > RETURN_MAX_AGE_MS)
      return null;
    return safeReturnTo(saved.path);
  } catch {
    return null;
  }
}
