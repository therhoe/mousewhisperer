import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getBillingDisplayAccess } from "../utils/billing.server";
import { trackerEditorUrl } from "../utils/snapshot-setup";
import { PRICING_PLANS } from "../utils/plans";
import { plansHref } from "../utils/navigation";
import { useBackgroundJson } from "../utils/background-json";
import { useLanguageSwitch } from "../components/LanguageMenu";
import { LOCALE_LABELS, SUPPORTED_LOCALES, useI18n, type AppLocale } from "../utils/i18n";
import type { StorefrontTrackerStatus } from "../utils/storefront-tracker-status.server";
import type { WebPixelStatus } from "../utils/web-pixel.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const access = await getBillingDisplayAccess(session.shop);
  return {
    editorUrl: trackerEditorUrl(session.shop, process.env.SHOPIFY_API_KEY || ""),
    plan: {
      code: access.plan,
      name: access.planName,
      isFree: access.isFree,
      usage: {
        store: access.usage.storeSnapshots,
        page: access.usage.normalSnapshots,
        abTests: access.usage.abTests,
      },
      limits: {
        store: access.limits.storeSnapshots,
        page: access.limits.normalSnapshots,
        abTests: access.limits.abTests,
      },
    },
  };
};

type SettingsPlan = Awaited<ReturnType<typeof loader>>["plan"];
type Status = "active" | "missing" | "unknown";
type TrackingPayload = { trackerStatus: StorefrontTrackerStatus; pixelStatus: WebPixelStatus };
const STATES: readonly string[] = ["active", "missing", "unknown"];

function isTrackingPayload(value: unknown): value is TrackingPayload {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<TrackingPayload>;
  return Boolean(
    data.trackerStatus &&
      STATES.includes(data.trackerStatus.status) &&
      typeof data.trackerStatus.storefrontUrl === "string" &&
      STATES.includes(String(data.pixelStatus)),
  );
}

export default function Settings() {
  const { editorUrl, plan } = useLoaderData<typeof loader>();
  const { t } = useI18n();
  return (
    <s-page heading={t("Settings")}>
      <s-stack gap="base">
        <TrackingSection editorUrl={editorUrl} />
        <LanguageSection />
        <PlanSection plan={plan} />
      </s-stack>
    </s-page>
  );
}

const BADGES = {
  active: { label: "Active", tone: "success" },
  missing: { label: "Not active", tone: "warning" },
  unknown: { label: "Not verified", tone: "neutral" },
} as const;

function StatusBadge({ status, loading, failed }: { status?: Status; loading: boolean; failed: boolean }) {
  const { t } = useI18n();
  if (status) return <s-badge tone={BADGES[status].tone}>{t(BADGES[status].label)}</s-badge>;
  return <s-badge>{t(failed ? "Unavailable" : loading ? "Checking…" : "Not verified")}</s-badge>;
}

function TrackingSection({ editorUrl }: { editorUrl: string | null }) {
  const { t } = useI18n();
  const { data, loading, error, reload } = useBackgroundJson({
    path: "/api/storefront-tracker-status",
    isData: isTrackingPayload,
    errorMessage: "Tracking status is temporarily unavailable.",
  });
  const embed = data?.trackerStatus.status;
  const pixel = data?.pixelStatus;
  const failed = Boolean(error);
  return (
    <s-section heading={t("Storefront tracking")}>
      <s-stack gap="base">
        <s-paragraph color="subdued">
          {t("Snapshot needs both parts on to record visits, add-to-cart and checkout.")}
        </s-paragraph>
        {embed === "missing" && (
          <s-banner tone="warning">{t("Snapshot Tracker must be turned on in your theme.")}</s-banner>
        )}
        <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
          <s-stack gap="small-500">
            <s-text type="strong">{t("Snapshot Tracker")}</s-text>
            <s-text color="subdued">
              {t("Theme app embed in your live theme. Records page views, clicks and scrolling.")}
            </s-text>
          </s-stack>
          <s-stack direction="inline" gap="small" alignItems="center">
            <StatusBadge status={embed} loading={loading} failed={failed} />
            {editorUrl && (
              <s-button href={editorUrl} target="_blank">
                {t("Open theme editor")}
              </s-button>
            )}
          </s-stack>
        </s-stack>
        <s-divider />
        <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
          <s-stack gap="small-500">
            <s-text type="strong">{t("Web pixel")}</s-text>
            <s-text color="subdued">
              {t("Records add-to-cart, checkout and purchases. Turned on automatically when a measurement starts.")}
            </s-text>
          </s-stack>
          <StatusBadge status={pixel} loading={loading} failed={failed} />
        </s-stack>
        {(failed || embed === "unknown" || pixel === "unknown") && (
          <s-button variant="tertiary" onClick={() => reload()} loading={loading}>
            {t("Retry")}
          </s-button>
        )}
      </s-stack>
    </s-section>
  );
}

function LanguageSection() {
  const { t } = useI18n();
  const { locale, change } = useLanguageSwitch();
  return (
    <s-section heading={t("Language")}>
      <s-select
        label={t("Language")}
        value={locale}
        details={t("Applies to Snapshot only. Your Shopify admin language stays the same.")}
        onChange={(event) =>
          change(String((event.currentTarget as unknown as { value: string }).value) as AppLocale)
        }
      >
        {SUPPORTED_LOCALES.map((option) => (
          <s-option key={option} value={option}>
            {LOCALE_LABELS[option]}
          </s-option>
        ))}
      </s-select>
    </s-section>
  );
}

function PlanSection({ plan }: { plan: SettingsPlan }) {
  const { t, formatNumber: n } = useI18n();
  const pricing = PRICING_PLANS.find((entry) => entry.billingPlan === plan.code);
  const name = plan.isFree
    ? t("Free")
    : pricing
      ? `${plan.name} · ${t("{price} every 30 days", { price: pricing.price })}`
      : plan.name;
  return (
    <s-section heading={t("Plan")}>
      <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
        <s-stack gap="small-500">
          <s-text type="strong">{name}</s-text>
          <s-text color="subdued">
            {t(
              "{store} of {storeLimit} store-level and {page} of {pageLimit} page-level measurements used · {tests} of {testLimit} A/B tests",
              {
                store: n(plan.usage.store),
                storeLimit: n(plan.limits.store),
                page: n(plan.usage.page),
                pageLimit: n(plan.limits.page),
                tests: n(plan.usage.abTests),
                testLimit: n(plan.limits.abTests),
              },
            )}
          </s-text>
        </s-stack>
        <s-button href={plansHref("/app/settings")}>{t("View plans")}</s-button>
      </s-stack>
    </s-section>
  );
}

// Single fetch applies route headers to data requests too; Shopify needs
// them so App Bridge can re-authenticate an expired session.
export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
