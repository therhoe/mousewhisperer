import { useState } from "react";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  DataTable,
  InlineGrid,
  InlineStack,
  Pagination,
  SkeletonBodyText,
  Text,
} from "@shopify/polaris";
import { useI18n } from "../utils/i18n";
import { useBackgroundJson } from "../utils/background-json";
import { GrowthLineChart, MetricTile } from "./GrowthOverviewCard";
import type { GrowthReport, GrowthReportFilters } from "../utils/growth-report";
import { EngagementOutcomesView } from "./EngagementOutcomes";
type Payload = { report: GrowthReport; comparison: GrowthReport | null };
const isPayload = (value: unknown): value is Payload =>
  !!value &&
  typeof value === "object" &&
  "report" in value &&
  typeof (value as Payload).report?.sessions === "number";
const CHANNEL_PAGE_SIZE = 10;
export function GrowthMeasurementResults({
  shop,
  projectId,
  measurementId,
  comparisonId,
  comparisonName,
  filters,
}: {
  shop: string;
  projectId: string;
  measurementId: string;
  comparisonId: string;
  comparisonName?: string;
  filters: GrowthReportFilters;
}) {
  const { t, formatNumber } = useI18n();
  const [channelPage, setChannelPage] = useState(0);
  const query = new URLSearchParams({
    projectId,
    measurement: measurementId,
    compare: comparisonId,
    ...filters,
  });
  const { data, loading, error, reload } = useBackgroundJson<Payload>({
    path: `/api/growth-report?${query}`,
    scopeKey: shop,
    isData: isPayload,
    errorMessage: t("Measurement results could not load. Please retry."),
  });
  const report = data?.report;
  const before = data?.comparison;
  const count = (value: number) => formatNumber(value);
  const percent = (value: number) =>
    `${formatNumber(value, { maximumFractionDigits: 2 })}%`;
  const versus = (value: string) =>
    before
      ? t("{value} in {name}", { value, name: comparisonName || t("comparison") })
      : undefined;
  const points = (current: number, previous: number) =>
    t("{change} pts", {
      change: formatNumber(current - previous, {
        signDisplay: "exceptZero",
        maximumFractionDigits: 2,
      }),
    });
  const pages = Math.max(
    1,
    Math.ceil((report?.channels.length || 0) / CHANNEL_PAGE_SIZE),
  );
  const page = Math.min(channelPage, pages - 1);
  if (!report)
    return (
      <Card>
        {error ? (
          <Banner tone="warning">
            <BlockStack gap="200">
              <p>{error}</p>
              <div>
                <Button onClick={reload}>{t("Retry")}</Button>
              </div>
            </BlockStack>
          </Banner>
        ) : (
          <BlockStack gap="400">
            <div role="status">
              <Text as="p" tone="subdued">
                {t(loading ? "Loading results…" : "No results available.")}
              </Text>
            </div>
            {loading && <SkeletonBodyText lines={8} />}
          </BlockStack>
        )}
      </Card>
    );
  return (
    <BlockStack gap="400">
      {error && <Banner tone="warning">{error}</Banner>}
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center" gap="200">
            <Text as="h2" variant="headingMd">
              {t("Summary")}
            </Text>
            <Button variant="tertiary" onClick={reload} loading={loading}>
              {t("Refresh")}
            </Button>
          </InlineStack>
          <InlineGrid columns={{ xs: 2, md: 4 }} gap="300">
            <MetricTile
              label={t("Sessions")}
              value={count(report.sessions)}
              caption={versus(count(before?.sessions || 0))}
            />
            <MetricTile
              label={t("Add-to-cart rate")}
              value={percent(report.atcRate)}
              caption={
                before
                  ? points(report.atcRate, before.atcRate)
                  : t("{count} added to cart", {
                      count: count(report.addedToCart),
                    })
              }
            />
            <MetricTile
              label={t("Converted sessions")}
              value={count(report.conversions)}
              caption={versus(count(before?.conversions || 0))}
            />
            <MetricTile
              label={t("Conversion rate")}
              value={percent(report.conversionRate)}
              caption={
                before
                  ? points(report.conversionRate, before.conversionRate)
                  : undefined
              }
            />
          </InlineGrid>
          {before && (
            <Text as="p" variant="bodySm" tone="subdued">
              {t(
                "Compared with {name} using the same filters. A before/after change suggests, but does not prove, that your change caused it. Use an A/B test for proof.",
                { name: comparisonName || t("comparison") },
              )}
            </Text>
          )}
        </BlockStack>
      </Card>
      <Card>
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">
            {t("Conversion rate over time")}
          </Text>
          <GrowthLineChart
            title={t("Conversion rate over time")}
            percent
            points={report.series.map((point) => ({
              date: point.date,
              value: point.conversionRate,
            }))}
          />
        </BlockStack>
      </Card>
      <Card padding="0">
        <Box padding="400" paddingBlockEnd="0">
          <Text as="h2" variant="headingMd">
            {t("Traffic by source")}
          </Text>
        </Box>
        {report.channels.length ? (
          <DataTable
            columnContentTypes={[
              "text",
              "text",
              "text",
              "numeric",
              "numeric",
              "numeric",
              "numeric",
            ]}
            headings={[
              t("Source"),
              t("Medium"),
              t("Campaign"),
              t("Sessions"),
              t("Added to cart"),
              t("Conversions"),
              t("Conversion rate"),
            ]}
            rows={report.channels
              .slice(page * CHANNEL_PAGE_SIZE, (page + 1) * CHANNEL_PAGE_SIZE)
              .map((row) => [
                row.source,
                row.medium || "—",
                row.campaign || "—",
                count(row.sessions),
                count(row.addedToCart),
                count(row.conversions),
                percent(row.conversionRate),
              ])}
          />
        ) : (
          <Box padding="400">
            <Text as="p" tone="subdued">
              {t("No sessions match these filters.")}
            </Text>
          </Box>
        )}
        {pages > 1 && (
          <Box padding="300">
            <InlineStack align="center">
              <Pagination
                hasPrevious={page > 0}
                onPrevious={() => setChannelPage(page - 1)}
                hasNext={page + 1 < pages}
                onNext={() => setChannelPage(page + 1)}
                label={t("Page {page} of {pages}", {
                  page: count(page + 1),
                  pages: count(pages),
                })}
              />
            </InlineStack>
          </Box>
        )}
      </Card>
      {report.engagement && report.engagement.groups.length > 0 && (
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              {t("Engagement by zone")}
            </Text>
            <EngagementOutcomesView
              data={report.engagement}
              audience={t(
                filters.audience === "active"
                  ? "Active sessions"
                  : "All recorded sessions",
              )}
              totals={Object.fromEntries(
                report.engagement.groups.map((group) => [
                  group.category,
                  group.items.reduce((sum, item) => sum + item.clicks, 0),
                ]),
              )}
            />
          </BlockStack>
        </Card>
      )}
      {report.engagementUnavailable && (
        <Banner tone="info">
          {t(
            "There is too much engagement data to show at once. Pick a source to narrow it down.",
          )}
        </Banner>
      )}
    </BlockStack>
  );
}
