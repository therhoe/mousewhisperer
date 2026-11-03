import { BlockStack, Card, InlineGrid, Text } from "@shopify/polaris";
import { useI18n } from "../utils/i18n";
import { MetricTile } from "./GrowthOverviewCard";
import type { GrowthFunnel } from "../utils/growth-report";

// Every step is a share of all sessions, never of the previous step: a purchase can
// be recorded without a tracked cart or checkout step.
export function GrowthConversionFunnel({
  funnel,
  before,
  comparisonName,
}: {
  funnel: GrowthFunnel;
  before?: GrowthFunnel | null;
  comparisonName?: string;
}) {
  const { t, formatNumber } = useI18n();
  const share = (value: number, sessions: number) =>
    sessions ? (100 * value) / sessions : 0;
  const percent = (value: number) =>
    `${formatNumber(value, { maximumFractionDigits: 2 })}%`;
  const name = comparisonName || t("comparison");
  const steps = [
    { key: "sessions", label: t("Sessions") },
    { key: "addedToCart", label: t("Added to cart") },
    { key: "checkoutStarted", label: t("Reached checkout") },
    { key: "purchased", label: t("Purchased") },
  ] as const;
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          {t("Conversion funnel")}
        </Text>
        <InlineGrid columns={{ xs: 2, md: 4 }} gap="300">
          {steps.map(({ key, label }) => {
            const current = share(funnel[key], funnel.sessions);
            let caption: string | undefined;
            if (key === "sessions")
              caption = before
                ? t("{value} in {name}", {
                    value: formatNumber(before.sessions),
                    name,
                  })
                : undefined;
            else
              caption = before
                ? t("{change} pts", {
                    change: formatNumber(
                      current - share(before[key], before.sessions),
                      { signDisplay: "exceptZero", maximumFractionDigits: 2 },
                    ),
                  })
                : t("{share} of sessions", { share: percent(current) });
            return (
              <MetricTile
                key={key}
                label={label}
                value={formatNumber(funnel[key])}
                caption={caption}
              />
            );
          })}
        </InlineGrid>
        <Text as="p" variant="bodySm" tone="subdued">
          {before
            ? t(
                "Compared with {name} using the same filters. A before/after change suggests, but does not prove, that your change caused it. Use an A/B test for proof.",
                { name },
              )
            : t(
                "Each step is a share of all sessions. A purchase can be recorded without a tracked cart step, so a later step can be larger than an earlier one.",
              )}
        </Text>
      </BlockStack>
    </Card>
  );
}
