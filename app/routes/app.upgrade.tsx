import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import {
  authenticate,
  isShopifyBillingTestMode,
} from "../shopify.server";
import { SIGNAL_PLAN, WHISPER_PLAN } from "../utils/billing-plans";
import {
  getBillingAccess,
  reconcileShopBillingFromShopify,
} from "../utils/billing.server";
import {
  PLAN_LIMITS,
  type BillingLimits,
} from "../utils/billing-plans";

const PRICING_PLANS = [
  {
    shopifyPlan: WHISPER_PLAN,
    billingPlan: "WHISPER" as const,
    name: "Whisper",
    tagline: "For stores moving from first audits into repeat page testing.",
    price: "$49.99",
    compareAt: "$79",
    recommended: false,
    accent: "#2c6ecb",
    background:
      "linear-gradient(145deg, #ffffff 0%, #f5fbff 55%, #eef5ff 100%)",
    limits: PLAN_LIMITS.WHISPER,
    features: [
      "5 store snapshots included",
      "50 audit snapshots included",
      "5 A/B tests included",
      "Up to 5,000 visitors per snapshot",
    ],
  },
  {
    shopifyPlan: SIGNAL_PLAN,
    billingPlan: "SIGNAL" as const,
    name: "Signal",
    tagline: "For teams using Mouse Whisperer as a decision engine.",
    price: "$99.99",
    compareAt: "$149",
    recommended: true,
    accent: "#8a6116",
    background:
      "linear-gradient(145deg, #fffaf0 0%, #fff5d6 42%, #effaf5 100%)",
    limits: PLAN_LIMITS.SIGNAL,
    features: [
      "20 store snapshots included",
      "250 audit snapshots included",
      "25 A/B tests included",
      "Up to 25,000 visitors per snapshot",
    ],
  },
];

const DEFAULT_MANAGED_PRICING_APP_HANDLE = "mousewhisperer";

function managedPricingUrl(shop: string) {
  const storeHandle = shop.replace(".myshopify.com", "");
  const appHandle =
    process.env.SHOPIFY_MANAGED_PRICING_APP_HANDLE ||
    DEFAULT_MANAGED_PRICING_APP_HANDLE;
  return `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await reconcileShopBillingFromShopify(admin, session.shop);
  const billingAccess = await getBillingAccess(session.shop);
  return json({
    billingAccess,
    freeLimits: PLAN_LIMITS.FREE,
    billingTestMode: isShopifyBillingTestMode(),
    managedPricingUrl: managedPricingUrl(session.shop),
  });
};

export default function UpgradePage() {
  const { billingAccess, freeLimits, billingTestMode, managedPricingUrl } =
    useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const approved = searchParams.get("billing") === "approved";
  const failed = searchParams.get("billing") === "not-approved";

  return (
    <Page
      title="Upgrade plan"
      subtitle="Choose the monthly Mouse Whisperer plan that matches how often you audit, test, and act on storefront behavior."
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <TitleBar title="Upgrade plan" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {approved ? (
              <Banner tone="success" title="Billing approved">
                <Text as="p">
                  Your plan is active. The new limits are now available across
                  snapshots and A/B tests.
                </Text>
              </Banner>
            ) : null}
            {failed ? (
              <Banner tone="warning" title="Billing was not completed">
                <Text as="p">
                  Shopify did not return an active subscription. Choose a plan
                  again when you are ready.
                </Text>
              </Banner>
            ) : null}
            {billingTestMode ? (
              <Banner tone="info" title="Billing test mode is on">
                <Text as="p">
                  Shopify will create test subscriptions in this environment.
                  Set <code>SHOPIFY_BILLING_TEST=false</code> in production to
                  create real merchant charges.
                </Text>
              </Banner>
            ) : null}

            <Card>
              <InlineStack align="space-between" blockAlign="center" gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Current plan
                  </Text>
                  <Text as="p" tone="subdued">
                    Limits count the snapshots and tests currently in this
                    store. Deleted records free capacity.
                  </Text>
                </BlockStack>
                <Badge tone={billingAccess.isFree ? "attention" : "success"}>
                  {billingAccess.planName}
                </Badge>
              </InlineStack>
            </Card>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                gap: 20,
              }}
            >
              {PRICING_PLANS.map((plan) => (
                <PlanCard
                  key={plan.shopifyPlan}
                  plan={plan}
                  currentPlan={billingAccess.plan}
                  managedPricingUrl={managedPricingUrl}
                />
              ))}
            </div>

            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Badge>Free</Badge>
                  <Text as="h2" variant="headingMd">
                    Free plan limits
                  </Text>
                </InlineStack>
                <PlanLimitGrid limits={freeLimits} />
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function PlanCard({
  plan,
  currentPlan,
  managedPricingUrl,
}: {
  plan: (typeof PRICING_PLANS)[number];
  currentPlan: string;
  managedPricingUrl: string;
}) {
  const isCurrent = currentPlan === plan.billingPlan;

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        minHeight: "100%",
        padding: 24,
        borderRadius: 16,
        border: plan.recommended
          ? `2px solid ${plan.accent}`
          : "1px solid var(--p-color-border)",
        background: plan.background,
        boxShadow: plan.recommended
          ? "0 18px 42px rgba(138, 97, 22, 0.16)"
          : "0 10px 26px rgba(44, 110, 203, 0.08)",
        boxSizing: "border-box",
      }}
    >
        {plan.recommended ? (
          <div
            style={{
              position: "absolute",
              top: 14,
              right: 14,
            }}
          >
            <Badge tone="attention">Recommended</Badge>
          </div>
        ) : null}
        <BlockStack gap="400">
          <BlockStack gap="200">
            <InlineStack gap="200" blockAlign="center">
              <span
                aria-hidden
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  background: plan.accent,
                  boxShadow: `0 0 18px ${plan.accent}66`,
                }}
              />
              <Text as="h2" variant="headingLg">
                {plan.name}
              </Text>
            </InlineStack>
            <Text as="p" tone="subdued">
              {plan.tagline}
            </Text>
          </BlockStack>

          <InlineStack gap="250" blockAlign="end">
            <Text as="p" variant="heading2xl" fontWeight="bold">
              {plan.price}
            </Text>
            <div style={{ paddingBottom: 4 }}>
              <InlineStack gap="150" blockAlign="center">
                <span
                  style={{
                    color: "var(--p-color-text-subdued)",
                    textDecoration: "line-through",
                    fontSize: 18,
                  }}
                >
                  {plan.compareAt}
                </span>
                <Text as="span" tone="subdued">
                  / month
                </Text>
              </InlineStack>
            </div>
          </InlineStack>

          <PlanLimitGrid limits={plan.limits} compact />

          <BlockStack gap="150">
            {plan.features.map((feature) => (
              <InlineStack key={feature} gap="200" blockAlign="start" wrap={false}>
                <span
                  aria-hidden
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 999,
                    background: "#d9f7e8",
                    color: "#008060",
                    display: "inline-grid",
                    placeItems: "center",
                    fontSize: 12,
                    fontWeight: 800,
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                >
                  ✓
                </span>
                <Text as="span">{feature}</Text>
              </InlineStack>
            ))}
          </BlockStack>

          <Button
            fullWidth
            variant={plan.recommended ? "primary" : "secondary"}
            disabled={isCurrent}
            url={managedPricingUrl}
            target="_top"
          >
            {isCurrent ? "Current plan" : `Continue with ${plan.name}`}
          </Button>
        </BlockStack>
    </div>
  );
}

function PlanLimitGrid({
  limits,
  compact = false,
}: {
  limits: BillingLimits;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: compact ? 8 : 12,
      }}
    >
      <UsageStat label="Store snapshots" value={limits.storeSnapshots} />
      <UsageStat label="Audit snapshots" value={limits.normalSnapshots} />
      <UsageStat label="A/B tests" value={limits.abTests} />
      <UsageStat
        label="Visitor target"
        value={limits.maxSnapshotTargetVisitors}
      />
    </div>
  );
}

function UsageStat({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 8,
        background: "rgba(255,255,255,0.7)",
      }}
    >
      <BlockStack gap="050">
        <Text as="p" tone="subdued" variant="bodySm">
          {label}
        </Text>
        <Text as="p" variant="headingMd" fontWeight="semibold">
          {value.toLocaleString()}
        </Text>
      </BlockStack>
    </div>
  );
}
