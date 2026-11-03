import {
  BlockStack,
  Card,
  DataTable,
  InlineGrid,
  InlineStack,
  ProgressBar,
  Text,
} from "@shopify/polaris";
import { useI18n } from "../utils/i18n";
import type {
  GrowthExitOutcome,
  GrowthExitPaths,
} from "../utils/growth-report";

export function GrowthExitPathsCard({
  exitPaths,
}: {
  exitPaths: GrowthExitPaths;
}) {
  const { t, formatNumber } = useI18n();
  const labels: Record<GrowthExitOutcome, string> = {
    internal_link: t("Continued to another page"),
    checkout: t("Went to cart or checkout"),
    back_button: t("Pressed back"),
    window_closed: t("Closed or switched tab"),
    idle: t("Went idle"),
    external_link: t("Left for another site"),
    unknown: t("Unknown"),
  };
  const percent = (value: number) =>
    `${formatNumber(value, { maximumFractionDigits: 1 })}%`;
  const outcomes = exitPaths.outcomes.filter((row) => row.pageViews > 0);
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          {t("Exit paths")}
        </Text>
        {!exitPaths.available ? (
          <Text as="p" tone="subdued">
            {t("Not recorded for this measurement")}
          </Text>
        ) : (
          <InlineGrid columns={{ xs: 1, md: 2 }} gap="500">
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                {t("How visitors left this page")}
              </Text>
              {outcomes.length ? (
                outcomes.map((row) => (
                  <BlockStack key={row.type} gap="100">
                    <InlineStack align="space-between" gap="200">
                      <Text as="span" variant="bodySm">
                        {labels[row.type]}
                      </Text>
                      <Text as="span" variant="bodySm" numeric>
                        {`${percent(row.share)} · ${formatNumber(row.pageViews)}`}
                      </Text>
                    </InlineStack>
                    <ProgressBar progress={row.share} size="small" />
                  </BlockStack>
                ))
              ) : (
                <Text as="p" tone="subdued">
                  {t("No sessions match these filters.")}
                </Text>
              )}
            </BlockStack>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                {t("Pages visitors went to next")}
              </Text>
              {exitPaths.nextPages.length ? (
                <DataTable
                  columnContentTypes={["text", "numeric"]}
                  headings={[t("Page"), t("Page views")]}
                  rows={exitPaths.nextPages.map((row) => [
                    row.path,
                    formatNumber(row.pageViews),
                  ])}
                />
              ) : (
                <Text as="p" tone="subdued">
                  {t("No visitor continued to another page yet.")}
                </Text>
              )}
            </BlockStack>
          </InlineGrid>
        )}
      </BlockStack>
    </Card>
  );
}
