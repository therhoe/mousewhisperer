import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSearchParams } from "react-router";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate, isShopifyBillingTestMode } from "../shopify.server";
import { getBillingAccess, reconcileShopBillingFromShopify } from "../utils/billing.server";
import { PLAN_LIMITS } from "../utils/billing-plans";
import {
  finishUpgrade,
  planChange,
  PRICING_PLANS,
  startUpgrade,
  type PricingPlan,
} from "../utils/plans";
import { managedPricingUrl } from "../utils/plans.server";
import { safeReturnTo } from "../utils/navigation";
import { BackAction } from "../components/polaris/navigation";
import { useI18n } from "../utils/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await reconcileShopBillingFromShopify(admin, session.shop);
  const access = await getBillingAccess(session.shop);
  return {
    shop: session.shop,
    plan: access.plan,
    planName: access.planName,
    isFree: access.isFree,
    usage: {
      store: access.usage.storeSnapshots,
      page: access.usage.normalSnapshots,
      abTests: access.usage.abTests,
    },
    limits: access.limits,
    freeLimits: PLAN_LIMITS.FREE,
    billingTestMode: isShopifyBillingTestMode(),
    managedPricingUrl: managedPricingUrl(session.shop),
  };
};

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export default function Plans() {
  const data = useLoaderData<typeof loader>();
  const { t, formatNumber } = useI18n();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const billing = params.get("billing");
  const returnTo = safeReturnTo(params.get("returnTo"));

  // Rule 5: after an approved upgrade, go back to the screen it started from.
  useEffect(() => {
    const back = finishUpgrade({ storage: browserStorage(), shop: data.shop, billing });
    if (!back) return;
    shopify.toast.show(t("Plan updated"));
    navigate(back, { replace: true });
  }, [billing, data.shop, navigate, shopify, t]);

  function upgrade() {
    startUpgrade({
      storage: browserStorage(),
      shop: data.shop,
      returnTo,
      url: data.managedPricingUrl,
      open: (url, target) => window.open(url, target),
    });
  }

  return (
    <s-page heading={t("Plans")}>
      <BackAction parentPath="/app" />
      <s-stack gap="base">
        {billing === "approved" && (
          <s-banner tone="success" heading={t("Billing approved")}>
            {t("Your plan is active. The new limits are available now.")}
          </s-banner>
        )}
        {billing === "not-approved" && (
          <s-banner tone="warning" heading={t("Billing was not completed")}>
            {t("Shopify did not return an active subscription. Choose a plan again when you're ready.")}
          </s-banner>
        )}
        {data.billingTestMode && (
          <s-banner tone="info" heading={t("Billing test mode is on")}>
            {t("Shopify creates test subscriptions in this environment.")}
          </s-banner>
        )}
        <s-banner tone={data.isFree ? "info" : "success"}>
          {data.isFree
            ? t("You're on the Free plan.")
            : t("You're on {plan}. Billed by Shopify every 30 days.", { plan: data.planName })}
        </s-banner>
        <s-section heading={t("Your usage")}>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
            <UsageTile label={t("Store-level measurements")} used={data.usage.store} limit={data.limits.storeSnapshots} />
            <UsageTile label={t("Page-level measurements")} used={data.usage.page} limit={data.limits.normalSnapshots} />
            <UsageTile label={t("A/B tests")} used={data.usage.abTests} limit={data.limits.abTests} />
            <s-box border="base" borderRadius="base" padding="base">
              <s-stack gap="small-200">
                <s-text color="subdued">{t("Visitor target")}</s-text>
                <s-text type="strong">
                  {t("Up to {count}", { count: formatNumber(data.limits.maxSnapshotTargetVisitors) })}
                </s-text>
                <s-text color="subdued">{t("per measurement")}</s-text>
              </s-stack>
            </s-box>
          </s-grid>
        </s-section>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))" gap="base">
          {PRICING_PLANS.map((plan) => (
            <PlanCard key={plan.billingPlan} plan={plan} currentPlan={data.plan} onUpgrade={upgrade} />
          ))}
        </s-grid>
        <s-section heading={t("Free")}>
          <s-paragraph>
            {t("{store} store-level and {page} page-level measurements, up to {visitors} visitors each, no A/B tests.", {
              store: formatNumber(data.freeLimits.storeSnapshots),
              page: formatNumber(data.freeLimits.normalSnapshots),
              visitors: formatNumber(data.freeLimits.maxSnapshotTargetVisitors),
            })}
          </s-paragraph>
        </s-section>
        <s-paragraph color="subdued">
          {t("Upgrade opens Shopify's plan page. When you confirm, you come back to the screen where you clicked Upgrade.")}
        </s-paragraph>
      </s-stack>
    </s-page>
  );
}

function UsageTile({ label, used, limit }: { label: string; used: number; limit: number }) {
  const { t, formatNumber } = useI18n();
  return (
    <s-box border="base" borderRadius="base" padding="base">
      <s-stack gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-text type="strong">
          {t("{used} of {limit}", { used: formatNumber(used), limit: formatNumber(limit) })}
        </s-text>
        <s-progress value={Math.min(used, limit)} max={Math.max(limit, 1)} accessibilityLabel={label} />
      </s-stack>
    </s-box>
  );
}

function PlanCard({
  plan,
  currentPlan,
  onUpgrade,
}: {
  plan: PricingPlan;
  currentPlan: string;
  onUpgrade: () => void;
}) {
  const { t, formatNumber } = useI18n();
  const current = currentPlan === plan.billingPlan;
  const change = planChange(currentPlan, plan.billingPlan);
  return (
    <s-section heading={plan.name}>
      <s-stack gap="base">
        {current ? (
          <s-badge tone="success">{t("Current plan")}</s-badge>
        ) : plan.recommended ? (
          <s-badge tone="info">{t("Recommended")}</s-badge>
        ) : null}
        <s-paragraph color="subdued">{t(plan.tagline)}</s-paragraph>
        <s-paragraph>
          <s-text type="strong">{plan.price}</s-text>{" "}
          <s-text color="subdued" type="redundant">{plan.compareAt}</s-text>{" "}
          <s-text color="subdued">{t("every 30 days")}</s-text>
        </s-paragraph>
        <s-unordered-list>
          <s-list-item>{t("{count} store-level measurements", { count: formatNumber(plan.limits.storeSnapshots) })}</s-list-item>
          <s-list-item>{t("{count} page-level measurements", { count: formatNumber(plan.limits.normalSnapshots) })}</s-list-item>
          <s-list-item>{t("{count} A/B tests", { count: formatNumber(plan.limits.abTests) })}</s-list-item>
          <s-list-item>
            {t("Up to {count} visitors per measurement", { count: formatNumber(plan.limits.maxSnapshotTargetVisitors) })}
          </s-list-item>
        </s-unordered-list>
        {current ? (
          <s-button disabled>{t("Current plan")}</s-button>
        ) : (
          <s-button variant={plan.recommended ? "primary" : "secondary"} onClick={onUpgrade}>
            {change === "upgrade"
              ? t("Upgrade to {plan}", { plan: plan.name })
              : t("Switch to {plan}", { plan: plan.name })}
          </s-button>
        )}
      </s-stack>
    </s-section>
  );
}

// Single fetch applies route headers to data requests too; Shopify needs
// them so App Bridge can re-authenticate an expired session.
export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
