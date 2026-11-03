import {
  BlockStack,
  Card,
  DataTable,
  InlineGrid,
  Text,
} from "@shopify/polaris";
import { useI18n } from "../utils/i18n";
import { MetricTile } from "./GrowthOverviewCard";
import type {
  GrowthEngagementSummary,
  GrowthExitPaths,
  GrowthReportLayout,
} from "../utils/growth-report";

export function GrowthEngagementMetrics({
  summary,
  layout,
  exitPages,
}: {
  summary: GrowthEngagementSummary;
  layout: GrowthReportLayout;
  exitPages: GrowthExitPaths["exitPages"];
}) {
  const { t, formatNumber } = useI18n();
  const store = layout === "store";
  const percent = (value: number) =>
    `${formatNumber(value, { maximumFractionDigits: 1 })}%`;
  const duration = (seconds: number) => {
    const whole = Math.round(seconds);
    const minutes = Math.floor(whole / 60);
    return minutes
      ? t("{minutes}m {seconds}s", {
          minutes: formatNumber(minutes),
          seconds: formatNumber(whole % 60),
        })
      : t("{seconds}s", { seconds: formatNumber(whole) });
  };
  const device = (value: string) =>
    value === "desktop"
      ? t("Desktop")
      : value === "mobile"
        ? t("Mobile")
        : value === "tablet"
          ? t("Tablet")
          : t("Unknown device");
  const heading = (
    <Text as="h2" variant="headingMd">
      {t("Engagement metrics")}
    </Text>
  );
  if (!summary.available)
    return (
      <Card>
        <BlockStack gap="200">
          {heading}
          <Text as="p" tone="subdued">
            {t("Not recorded for this measurement")}
          </Text>
        </BlockStack>
      </Card>
    );
  return (
    <Card>
      <BlockStack gap="500">
        {heading}
        <InlineGrid columns={{ xs: 2, md: store ? 5 : 3 }} gap="300">
          <MetricTile
            label={store ? t("Time on site") : t("Time on page")}
            value={duration(summary.timeMedianSeconds)}
            caption={t("Typical (median) per session")}
          />
          {store && (
            <MetricTile
              label={t("Pages per session")}
              value={formatNumber(summary.pagesPerSession, {
                maximumFractionDigits: 1,
              })}
            />
          )}
          <MetricTile
            label={t("Scroll depth")}
            value={percent(summary.averageScroll)}
            caption={t("Average per page view")}
          />
          {store && (
            <MetricTile
              label={t("Click-through rate")}
              value={percent(summary.clickThroughRate)}
              caption={t("Clicked from the page to another store page")}
            />
          )}
          <MetricTile
            label={t("Sessions that searched")}
            value={percent(summary.searchRate)}
          />
        </InlineGrid>
        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              {t("Top searches")}
            </Text>
            {summary.topSearches.length ? (
              <DataTable
                columnContentTypes={["text", "numeric"]}
                headings={[t("Search term"), t("Sessions")]}
                rows={summary.topSearches.map((row) => [
                  row.term,
                  formatNumber(row.sessions),
                ])}
              />
            ) : (
              <Text as="p" tone="subdued">
                {t("No search term was used by two or more sessions yet.")}
              </Text>
            )}
          </BlockStack>
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              {t("Devices")}
            </Text>
            {summary.devices.length ? (
              <DataTable
                columnContentTypes={["text", "numeric", "numeric"]}
                headings={[
                  t("Device"),
                  t("Share of sessions"),
                  t("Conversion rate"),
                ]}
                rows={summary.devices.map((row) => [
                  device(row.device),
                  percent(row.share),
                  percent(row.conversionRate),
                ])}
              />
            ) : (
              <Text as="p" tone="subdued">
                {t("No sessions match these filters.")}
              </Text>
            )}
          </BlockStack>
        </InlineGrid>
        {store && (
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              {t("Top exit pages")}
            </Text>
            {exitPages.length ? (
              <DataTable
                columnContentTypes={["text", "numeric", "numeric"]}
                headings={[t("Page"), t("Exits"), t("Exit rate")]}
                rows={exitPages.map((row) => [
                  row.path,
                  formatNumber(row.exits),
                  percent(row.exitRate),
                ])}
              />
            ) : (
              <Text as="p" tone="subdued">
                {t("No exits recorded yet.")}
              </Text>
            )}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}
