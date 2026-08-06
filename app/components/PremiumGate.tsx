import {
  Badge,
  BlockStack,
  Button,
  Card,
  InlineStack,
  ProgressBar,
  Text,
} from "@shopify/polaris";

type BillingAccessLike = {
  plan: string;
  planName?: string;
  usage: {
    storeSnapshots: number;
    normalSnapshots: number;
    abTests: number;
  };
  limits: {
    storeSnapshots: number;
    normalSnapshots: number;
    maxSnapshotTargetVisitors: number;
    abTests: number;
  };
};

type PremiumGateCardProps = {
  title: string;
  message: string;
  action?: string;
  url?: string;
};

const meterRows = [
  {
    key: "storeSnapshots",
    label: "Store snapshots",
  },
  {
    key: "normalSnapshots",
    label: "Audit snapshots",
  },
  {
    key: "abTests",
    label: "A/B tests",
  },
] as const;

export function PremiumGateCard({
  title,
  message,
  action = "Upgrade plan",
  url = "/app/upgrade",
}: PremiumGateCardProps) {
  return (
    <Card padding="0">
      <style>{`
        @keyframes mw-premium-sweep {
          0% { transform: translateX(-120%); opacity: 0; }
          35% { opacity: 0.9; }
          100% { transform: translateX(120%); opacity: 0; }
        }
        @keyframes mw-premium-glow {
          0%, 100% { box-shadow: 0 0 0 rgba(47, 128, 237, 0); }
          50% { box-shadow: 0 0 24px rgba(47, 128, 237, 0.18); }
        }
      `}</style>
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          padding: 20,
          borderRadius: 8,
          border: "1px solid #d7e3ff",
          background:
            "linear-gradient(135deg, #f7fbff 0%, #ffffff 48%, #fff8ec 100%)",
          animation: "mw-premium-glow 3.8s ease-in-out infinite",
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            width: "70%",
            background:
              "linear-gradient(90deg, transparent, rgba(255,255,255,0.85), transparent)",
            animation: "mw-premium-sweep 4.5s ease-in-out infinite",
          }}
        />
        <InlineStack align="space-between" blockAlign="center" gap="400">
          <BlockStack gap="150">
            <InlineStack gap="200" blockAlign="center">
              <Badge tone="info">Premium</Badge>
              <Text as="h3" variant="headingMd">
                {title}
              </Text>
            </InlineStack>
            <Text as="p" tone="subdued">
              {message}
            </Text>
          </BlockStack>
          <Button variant="primary" url={url}>
            {action}
          </Button>
        </InlineStack>
      </div>
    </Card>
  );
}

type PlanUsageMetric = keyof BillingAccessLike["usage"];

const metricCopy: Record<
  PlanUsageMetric,
  { noun: string; compactNoun: string }
> = {
  storeSnapshots: {
    noun: "store snapshots",
    compactNoun: "store snapshots",
  },
  normalSnapshots: {
    noun: "audit snapshots",
    compactNoun: "snapshots",
  },
  abTests: {
    noun: "A/B tests",
    compactNoun: "A/B tests",
  },
};

export function planUsagePillLabel(
  access: BillingAccessLike,
  metric: PlanUsageMetric,
) {
  const used = access.usage[metric];
  const limit = access.limits[metric];
  const planLabel =
    access.plan === "FREE"
      ? "Free plan"
      : access.planName ||
        access.plan.charAt(0) + access.plan.slice(1).toLowerCase();
  return `${planLabel} · ${used}/${limit} ${metricCopy[metric].compactNoun}`;
}

export function PlanUsagePill({
  access,
  metric,
  url = "/app/upgrade",
}: {
  access: BillingAccessLike;
  metric: PlanUsageMetric;
  url?: string;
}) {
  const used = access.usage[metric];
  const limit = access.limits[metric];
  const isFull = limit > 0 && used >= limit;
  const isUnavailable = limit === 0;
  const tone = isUnavailable || isFull ? "attention" : "success";

  return (
    <Button url={url} size="slim">
      <InlineStack gap="150" blockAlign="center" wrap={false}>
        <Badge tone={access.plan === "FREE" ? "attention" : "success"}>
          {access.plan === "FREE"
            ? "Free plan"
            : access.planName || access.plan}
        </Badge>
        <Text as="span" variant="bodySm" fontWeight="semibold">
          {used}/{limit} {metricCopy[metric].compactNoun}
        </Text>
        <Badge tone={tone}>
          {isUnavailable ? "Upgrade" : isFull ? "Full" : "Available"}
        </Badge>
      </InlineStack>
    </Button>
  );
}

export function PlanUsageCard({ access }: { access: BillingAccessLike }) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="050">
            <Text as="h2" variant="headingMd">
              Current plan
            </Text>
            <Text as="p" tone="subdued">
              Free limits are enforced across all snapshots and tests.
            </Text>
          </BlockStack>
          <Badge tone={access.plan === "FREE" ? "attention" : "success"}>
            {access.plan}
          </Badge>
        </InlineStack>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          {meterRows.map((row) => {
            const used = access.usage[row.key];
            const limit = access.limits[row.key];
            const progress =
              limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
            return (
              <BlockStack key={row.key} gap="150">
                <InlineStack align="space-between">
                  <Text as="span" tone="subdued">
                    {row.label}
                  </Text>
                  <Text as="span" fontWeight="semibold">
                    {used}/{limit}
                  </Text>
                </InlineStack>
                <ProgressBar
                  progress={progress}
                  tone={progress >= 100 ? "critical" : "primary"}
                  size="small"
                />
              </BlockStack>
            );
          })}
        </div>
        <Text as="p" tone="subdued">
          Snapshot target limit:{" "}
          {access.limits.maxSnapshotTargetVisitors.toLocaleString()} visitors.
        </Text>
      </BlockStack>
    </Card>
  );
}

export function TargetLimitText({
  max,
  label = "Free plan limit",
}: {
  max: number;
  label?: string;
}) {
  return (
    <Text as="p" tone="subdued">
      {label}: up to {max.toLocaleString()} visitors per snapshot.
    </Text>
  );
}
