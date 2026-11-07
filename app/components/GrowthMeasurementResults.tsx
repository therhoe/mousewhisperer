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
import { MetricTile } from "./GrowthOverviewCard";
import { GrowthConversionFunnel } from "./GrowthConversionFunnel";
import { GrowthEngagementMetrics } from "./GrowthEngagementMetrics";
import { GrowthExitPathsCard } from "./GrowthExitPaths";
import { GrowthSessionsByPage } from "./GrowthSessionsByPage";
import type { GrowthReport, GrowthReportFilters } from "../utils/growth-report";
import { EngagementOutcomesView } from "./EngagementOutcomes";
import {
  PARTIAL_REVENUE_MARK,
  revenueCell,
  revenueText,
} from "../utils/revenue";
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
  const clickThrough =
    report.pageType !== null && report.pageType !== "PRODUCT";
  const summary = report.engagementSummary;
  // Revenue sits beside every conversion rate (spec 7.2), in the shop's currency.
  const money = { t, formatNumber };
  const revenue = revenueText(report.conversions, report, report.currency, money);
  const beforeRevenue = before
    ? revenueText(before.conversions, before, report.currency, money)
    : null;
  const channelRows = report.channels.slice(
    page * CHANNEL_PAGE_SIZE,
    (page + 1) * CHANNEL_PAGE_SIZE,
  );
  const channelRevenue = channelRows.map((row) =>
    revenueText(row.conversions, row, report.currency, money),
  );
  // A rate change against a comparison with no sessions is not a real change.
  const compared = !!before && before.sessions > 0;
  const conversionMetrics = (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          {t("Conversion metrics")}
        </Text>
        <InlineGrid columns={{ xs: 2, md: 5 }} gap="300">
          <MetricTile
            label={t("Sessions")}
            value={count(report.sessions)}
            caption={versus(count(before?.sessions || 0))}
          />
          {clickThrough ? (
            <MetricTile
              label={t("Click-through rate")}
              value={
                summary.available
                  ? percent(summary.clickThroughRate)
                  : t("Not recorded")
              }
              caption={
                compared &&
                summary.available &&
                before.engagementSummary.available
                  ? points(
                      summary.clickThroughRate,
                      before.engagementSummary.clickThroughRate,
                    )
                  : report.pageType === "COLLECTION"
                    ? t("Clicked through to a product")
                    : t("Clicked through to another page")
              }
            />
          ) : (
            <MetricTile
              label={t("Add-to-cart rate")}
              value={percent(report.atcRate)}
              caption={
                compared
                  ? points(report.atcRate, before.atcRate)
                  : t("{count} added to cart", {
                      count: count(report.addedToCart),
                    })
              }
            />
          )}
          <MetricTile
            label={t("Converted sessions")}
            value={count(report.conversions)}
            caption={versus(count(before?.conversions || 0))}
          />
          <MetricTile
            label={t("Conversion rate")}
            value={percent(report.conversionRate)}
            caption={
              compared
                ? points(report.conversionRate, before.conversionRate)
                : undefined
            }
          />
          <MetricTile
            label={t("Revenue")}
            value={revenue.value}
            caption={
              revenue.hint ??
              (beforeRevenue ? versus(beforeRevenue.value) : undefined)
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
  );
  const trafficBySource = (
    <Card padding="0">
      <Box padding="400" paddingBlockEnd="0">
        <Text as="h2" variant="headingMd">
          {t("Traffic by source")}
        </Text>
      </Box>
      {report.channels.length ? (
        <>
          <DataTable
            columnContentTypes={[
              "text",
              "text",
              "text",
              "numeric",
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
              t("Revenue"),
            ]}
            rows={channelRows.map((row, index) => [
              row.source,
              row.medium || "—",
              row.campaign || "—",
              count(row.sessions),
              count(row.addedToCart),
              count(row.conversions),
              percent(row.conversionRate),
              revenueCell(channelRevenue[index]),
            ])}
          />
          {channelRevenue.some((text) => text.partial) && (
            <Box padding="400" paddingBlockStart="0">
              <Text as="p" variant="bodySm" tone="subdued">
                {`${PARTIAL_REVENUE_MARK} ${t("Some orders have no recorded amount")}`}
              </Text>
            </Box>
          )}
        </>
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
  );
  const engagement = report.engagement;
  const hasZones = !!engagement && engagement.groups.length > 0;
  const zones = (hasZones || !summary.available) && (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          {t("Engagement by zone")}
        </Text>
        {engagement && hasZones ? (
          <EngagementOutcomesView
            data={engagement}
            audience={t(
              filters.audience === "active"
                ? "Active sessions"
                : "All recorded sessions",
            )}
            totals={Object.fromEntries(
              engagement.groups.map((group) => [
                group.category,
                group.items.reduce((sum, item) => sum + item.clicks, 0),
              ]),
            )}
          />
        ) : (
          <Text as="p" tone="subdued">
            {t("Not recorded for this measurement")}
          </Text>
        )}
      </BlockStack>
    </Card>
  );
  return (
    <BlockStack gap="400">
      {error && <Banner tone="warning">{error}</Banner>}
      <InlineStack align="end">
        <Button variant="tertiary" onClick={reload} loading={loading}>
          {t("Refresh")}
        </Button>
      </InlineStack>
      {report.layout === "store" ? (
        <>
          <GrowthEngagementMetrics
            summary={summary}
            layout="store"
            exitPages={report.exitPaths.exitPages}
            currency={report.currency}
          />
          <GrowthConversionFunnel
            funnel={report.funnel}
            before={before?.funnel}
            comparisonName={comparisonName}
            currency={report.currency}
          />
          {trafficBySource}
          <GrowthSessionsByPage
            pages={report.pages}
            available={report.exitPaths.available}
            currency={report.currency}
          />
        </>
      ) : (
        <>
          {conversionMetrics}
          <GrowthEngagementMetrics
            summary={summary}
            layout="page"
            exitPages={[]}
            currency={report.currency}
          />
          {zones}
          {report.engagementUnavailable && (
            <Banner tone="info">
              {t(
                "There is too much engagement data to show at once. Pick a source to narrow it down.",
              )}
            </Banner>
          )}
          <GrowthExitPathsCard exitPaths={report.exitPaths} />
          {trafficBySource}
        </>
      )}
    </BlockStack>
  );
}
